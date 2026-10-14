import type { Logger } from "pino";
import { AlertEvaluator } from "@/alert";
import { NotificationDispatcher } from "@/alert/notifiers";
import type { AlertEvent, EndpointCheck, ValidatorStatus } from "@/alert/types";
import type { ChainConfig, GlobalAlertsConfig } from "@/config/app_config";
import { IngestLayer } from "@/ingest";
import { bech32ValconsToHex } from "@/pkgs/address/valcons";
import type { IWriteDb } from "@/pkgs/database/interfaces";
import { type Alert, Block, ValidatorInactivity } from "@/pkgs/database/tables";
import logger from "@/pkgs/logger";
import { QueryOperator } from "@/query";
import type { BlockCommitResponse } from "@/query/rpc/types";

const log = logger.child({ module: "ChainWorker" });

// Used when a chain has no configured signingWindowSize and (for bft) the chain's own
// signed_blocks_window couldn't be fetched. Matches a common Cosmos SDK default.
const DEFAULT_SIGNING_WINDOW_SIZE = 10_000;

// Used when a chain has no configured maxBlocksPerPoll.
const DEFAULT_MAX_BLOCKS_PER_POLL = 100;

// Returns the validator's operator account: valoper (bft) or operator (tm2).
function operatorAddress(chain: ChainConfig): string {
  return chain.chainType === "bft" ? chain.valoperAddress : chain.operatorAddress;
}

// Returns the signing address: valcons (bft) or signing (tm2) address.
function signerAddress(chain: ChainConfig): string {
  return chain.chainType === "bft" ? chain.valconsAddress : chain.signingAddress;
}

/**
 * Resolves the signing window size once at worker startup not re-fetched every poll, since
 * signed_blocks_window changes rarely (only via a governance param change). An explicit
 * `alertConfig.signingWindowSize` always wins (still this isn't recommended, for bft).
 * Otherwise: bft chains fetch signed_blocks_window from the chain's own slashing params
 * (`/cosmos/slashing/v1beta1/params`, apiUrls is mandatory for bft!)
 * tm2 has no such endpoint, so it always falls back to DEFAULT_SIGNING_WINDOW_SIZE unless overridden.
 * @param chain The chain configuration.
 * @param query The query operator.
 * @param chainLog The chain logger.
 * @returns The resolved signing window size.
 */
async function resolveSigningWindowSize(
  chain: ChainConfig,
  query: QueryOperator,
  chainLog: Logger,
): Promise<number> {
  if (chain.alertConfig.signingWindowSize != null) {
    return chain.alertConfig.signingWindowSize;
  }
  if (chain.chainType === "tm2") {
    return DEFAULT_SIGNING_WINDOW_SIZE;
  }
  const result = await query.getSlashingParams();
  if (result.ok) {
    return result.data.params.signedBlocksWindow;
  }
  chainLog.warn(
    "Failed to fetch signed_blocks_window from slashing params, defaulting to %d: %s",
    DEFAULT_SIGNING_WINDOW_SIZE,
    result.error,
  );
  return DEFAULT_SIGNING_WINDOW_SIZE;
}

/**
 * Fetches the full active validator set once (bft only) and caches it as a Set of uppercase
 * hex consensus addresses. Deliberately NOT re-fetched per poll or per block.
 * Valset endpoint is comparatively expensive, and per-commit membership doubt is resolved via
 * the much lighter single-validator lookup in `resolveActiveFallback` instead. Returns
 * `undefined` on failure (every ambiguous commit then falls back to that lighter lookup).
 */
async function fetchActiveSetHex(
  chain: ChainConfig,
  query: QueryOperator,
  height: number,
  chainLog: Logger,
): Promise<Set<string> | undefined> {
  if (chain.chainType !== "bft") return undefined;
  const valsetResult = await query.getValset(height);
  if (!valsetResult.ok) {
    chainLog.warn(
      `Failed to fetch validator set at startup, active-set checks will fall back to per-commit validator lookups: ${valsetResult.error ?? "unknown error"}`,
    );
    return undefined;
  }
  const hexAddresses = new Set<string>();
  for (const v of valsetResult.data.validators) {
    const hex = consensusAddressToHex(v.address);
    if (hex != null) hexAddresses.add(hex);
  }
  return hexAddresses;
}

/**
 * The validatorsets REST endpoint returns bech32 consensus addresses (`cosmosvalcons1...`),
 * while commit signatures use raw hex - normalize to uppercase hex. Already-hex input is
 * accepted as-is. Returns undefined for anything unparseable.
 */
function consensusAddressToHex(address: string): string | undefined {
  if (/^[0-9a-fA-F]{40}$/.test(address)) return address.toUpperCase();
  try {
    return bech32ValconsToHex(address);
  } catch {
    return undefined;
  }
}

/** Mutable, memoized within a single poll cycle. */
interface ActiveFallbackCache {
  /** Memoized answer, reused for every later (higher) ambiguous height in this poll. */
  value: boolean | undefined;
  /** The validator's status as of this poll, or the last known one (undefined if unknown at
   * all) - see resolveActiveFallback. */
  currentlyActive?: boolean | undefined;
}

/**
 * Instead of re-fetching the whole valset, this queries the single-validator
 * REST endpoint at the commit's own height (via the x-cosmos-block-height header). Should be much
 * cheaper since we only pull one validator's data.
 *
 * Commits are processed in ascending height order, so a looked-up answer is only memoized once
 * it matches the validator's current status: from there on nothing changes up to the present.
 * An answer that differs (the poll's range crosses a jail/unjail) is used for that height only,
 * and the next ambiguous height is looked up again - otherwise e.g. a pre-jail "active" answer
 * would turn every post-jail block in the same poll into a miss.
 */
async function resolveActiveFallback(
  chain: ChainConfig,
  query: QueryOperator,
  height: number,
  cache: ActiveFallbackCache,
  chainLog: Logger,
): Promise<boolean> {
  if (cache.value !== undefined) return cache.value;
  const valData = await query.getValidatorData(operatorAddress(chain), height);
  if (!valData.ok) {
    // Fall back to the last known status (active if nothing is known).
    const assumed = cache.currentlyActive ?? true;
    chainLog.warn(
      "Failed to confirm active-set status, assuming %s: %s",
      assumed ? "active" : "inactive",
      valData.error,
    );
    // Memoize the failure too, so a down API isn't retried for every block in the poll.
    cache.value = assumed;
    return assumed;
  }
  const { jailed, status } = valData.data.validator;
  const active = !jailed && status === "BOND_STATUS_BONDED";
  if (cache.currentlyActive === undefined || cache.currentlyActive === active) {
    cache.value = active;
  }
  return active;
}

/**
 * commitToBlock converts a raw commit into a Block, resolving the tri-state `signed` value:
 * -1 = validator wasn't in the active set (bft only), 0 = active but missed, 1 = active and signed.
 * A signature entry present in the commit is definitive (the validator is obviously active if
 * it has an entry at all) - active-set membership is only checked when no entry is found.
 * @param valconsHex precomputed uppercase hex consensus address (bft only, undefined for tm2)
 * @param activeSetHex cached active set from worker startup (bft only, undefined if unavailable)
 * @param fallbackCache memoized per-poll cache for the resolveActiveFallback lookup
 */
export async function commitToBlock(
  commit: BlockCommitResponse,
  chain: ChainConfig,
  valconsHex: string | undefined,
  activeSetHex: Set<string> | undefined,
  query: QueryOperator,
  fallbackCache: ActiveFallbackCache,
  chainLog: Logger,
): Promise<Block> {
  const { header, commit: commitData } = commit.result.signedHeader;
  const height = BigInt(header.height);
  const time = new Date(header.time);
  const hash = commitData.blockId.hash;

  let signed: number = 0;
  let signature: string | undefined;
  let precommitted: boolean | undefined;

  if ("signatures" in commitData && commitData.signatures != null) {
    // Cosmos BFT path - identify validator by hex consensus address
    const sig = commitData.signatures.find((s) => s != null && s.validatorAddress === valconsHex);
    if (sig != null) {
      precommitted = sig.blockIdFlag === 2;
      signed = sig.blockIdFlag === 2 || sig.blockIdFlag === 3 ? 1 : 0;
      if (signed === 1 && sig.signature != null) signature = sig.signature;
    } else if (activeSetHex?.has(valconsHex ?? "")) {
      // No signature entry, but the validator is a known active-set member - a clear miss,
      // no further request needed.
      signed = 0;
    } else {
      const active = await resolveActiveFallback(
        chain,
        query,
        Number(header.height),
        fallbackCache,
        chainLog,
      );
      signed = active ? 0 : -1;
    }
  } else if ("precommits" in commitData && commitData.precommits != null) {
    // TM2 path - precommits identify validators by signing address, not operator address.
    // Some older tm2 chains (e.g. early Gnoland) happened to use the same value for both, which
    // is coincidence, not a guarantee - don't rely on it holding elsewhere.
    const addr = signerAddress(chain);
    const pre = commitData.precommits.find((p) => p != null && p.validatorAddress === addr);
    if (pre != null) {
      precommitted = pre.type === 2;
      signed = pre.type === 2 || pre.type === 3 ? 1 : 0;
      if (signed === 1 && pre.signature != null) signature = pre.signature;
    }
  } else {
    signed = 0;
  }

  return new Block({
    chainId: chain.chainId,
    height,
    hash,
    time,
    signed,
    signature,
    chainType: chain.chainType,
    precommitted,
  });
}

/**
 * Resolves the validator's status at `height` (bft only): jailed and bond status from the
 * staking validator endpoint and, only when jailed, jail end time and tombstoned flag from the
 * slashing signing info. Both are queried as of `height` (x-cosmos-block-height header) so the
 * answers are consistent with each other and with the recorded height. Returns undefined when
 * the status can't be determined - callers must then leave status-dependent state untouched.
 */
async function resolveValidatorStatus(
  chain: ChainConfig,
  query: QueryOperator,
  height: number,
  time: Date,
  chainLog: Logger,
): Promise<ValidatorStatus | undefined> {
  if (chain.chainType !== "bft") return undefined;
  const valData = await query.getValidatorData(operatorAddress(chain), height);
  if (!valData.ok) {
    chainLog.warn("Failed to fetch validator status at height %d: %s", height, valData.error);
    return undefined;
  }
  const { jailed, status: bondStatus } = valData.data.validator;

  let permanent = false;
  let jailedUntil: Date | undefined;
  if (jailed) {
    const info = await query.getSigningInfo(chain.valconsAddress, height);
    if (info.ok) {
      // `tombstoned` may be omitted from the JSON when false.
      permanent = info.data.valSigningInfo.tombstoned === true;
      const until = info.data.valSigningInfo.jailedUntil;
      if (until != null) {
        const parsed = new Date(until);
        if (!Number.isNaN(parsed.getTime())) {
          jailedUntil = parsed;
          // A tombstoned validator is jailed until the end of time (9999-12-31).
          if (parsed.getUTCFullYear() >= 9999) permanent = true;
        }
      }
    } else {
      chainLog.warn(
        "Validator is jailed but its signing info couldn't be fetched, can't tell whether it's tombstoned: %s",
        info.error,
      );
    }
  }

  return {
    height: BigInt(height),
    time,
    active: !jailed && bondStatus === "BOND_STATUS_BONDED",
    jailed,
    permanent,
    bondStatus,
    ...(jailedUntil != null ? { jailedUntil } : {}),
  };
}

/**
 * Keeps the validator_inactivity table in sync with the validator's status: starts a period when
 * the validator leaves the active set, starts a new one when the reason changes (e.g. jailed ->
 * tombstoned), and ends the ongoing one when the validator is back. Independent of alert config.
 */
async function recordInactivity(
  chain: ChainConfig,
  db: IWriteDb,
  status: ValidatorStatus,
  open: ValidatorInactivity | null,
  chainLog: Logger,
): Promise<void> {
  const sameReason =
    open != null && open.jailed === status.jailed && open.permanent === status.permanent;
  if (status.active || (open != null && !sameReason)) {
    if (open != null) {
      const r = await db.endInactivity(open.height, status.height, status.time);
      if (!r.ok) chainLog.error("Failed to end validator inactivity: %s", r.error);
    }
  }
  if (!status.active && !sameReason) {
    const r = await db.insertInactivity(
      new ValidatorInactivity({
        chainId: chain.chainId,
        height: status.height,
        time: status.time,
        jailed: status.jailed,
        permanent: status.permanent,
        bondStatus: status.bondStatus,
        ...(status.jailedUntil != null ? { jailedUntil: status.jailedUntil } : {}),
      }),
    );
    if (!r.ok) chainLog.error("Failed to record validator inactivity: %s", r.error);
  }
}

// Same normalization RpcClient/ApiClient apply to their URLs.
function normalizeUrl(url: string): string {
  url = url.trim();
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

/** Every configured endpoint with its last known health, for rpc_down/api_down evaluation. */
function endpointChecks(chain: ChainConfig, query: QueryOperator): EndpointCheck[] {
  const health = query.endpointHealth();
  const checks: EndpointCheck[] = [];
  const add = (kind: "rpc" | "api", configured: { url: string; alertIfDown: boolean }) => {
    const url = normalizeUrl(configured.url);
    const known = (kind === "rpc" ? health.rpc : health.api)?.find((e) => e.url === url);
    checks.push({
      kind,
      url,
      alertIfDown: configured.alertIfDown,
      healthy: known?.healthy,
      ...(known?.reason != null ? { reason: known.reason } : {}),
    });
  };
  for (const rpc of chain.rpcUrls) add("rpc", rpc);
  if (chain.chainType === "bft") for (const api of chain.apiUrls ?? []) add("api", api);
  return checks;
}

/** Exported for integration tests that want to drive individual poll cycles directly.
 * @param valconsHex precomputed uppercase hex consensus address (bft only, undefined for tm2)
 * @param signingWindowSize precomputed once at worker startup - see resolveSigningWindowSize
 * @param activeSetHex cached active set fetched once at worker startup - see fetchActiveSetHex */
export async function doPoll(
  chain: ChainConfig,
  query: QueryOperator,
  ingest: IngestLayer,
  alertEval: AlertEvaluator,
  dispatcher: NotificationDispatcher,
  db: IWriteDb,
  valconsHex: string | undefined,
  signingWindowSize: number,
  activeSetHex: Set<string> | undefined,
): Promise<void> {
  const chainLog = log.child({ chainId: chain.chainId });

  const openAlertsResult = await db.getUnclosedAlerts(500, 1); // probably an overkill
  if (!openAlertsResult.ok) {
    chainLog.error("Failed to read open alerts: %s", openAlertsResult.error);
    return;
  }
  const openAlerts = openAlertsResult.value;

  const events = await pollChain(
    chain,
    query,
    ingest,
    alertEval,
    db,
    valconsHex,
    signingWindowSize,
    activeSetHex,
    openAlerts,
    chainLog,
  );
  // Endpoint health is evaluated even when the chain itself couldn't be polled - that is
  // exactly when an rpc_down alert matters most. The health snapshot was refreshed (if stale)
  // by the queries pollChain just made.
  events.push(...alertEval.evaluateEndpoints(endpointChecks(chain, query), openAlerts));

  for (const event of events) {
    if (event.kind === "open") {
      const r = await ingest.ingestAlert(event.alert);
      if (!r.ok) chainLog.error("Failed to insert alert %s: %s", event.alert.alertId, r.error);
    } else if (event.kind === "repeat") {
      const r = await db.touchAlertNotified(
        event.alert.alertId,
        new Date(),
        event.alert.repeatCount + 1,
      );
      if (!r.ok) chainLog.error("Failed to touch alert %s: %s", event.alert.alertId, r.error);
    } else {
      const r = await ingest.closeAlert(event.alert.alertId, event.closedAt);
      if (!r.ok) chainLog.error("Failed to close alert %s: %s", event.alert.alertId, r.error);
    }
    await dispatcher.dispatch(event, chain.chainId);
  }
}

/**
 * One poll of the chain itself: ingests new blocks, records the validator's status and
 * evaluates the chain/validator alerts. Returns the alert events to apply ([] if the chain
 * couldn't be polled).
 */
async function pollChain(
  chain: ChainConfig,
  query: QueryOperator,
  ingest: IngestLayer,
  alertEval: AlertEvaluator,
  db: IWriteDb,
  valconsHex: string | undefined,
  signingWindowSize: number,
  activeSetHex: Set<string> | undefined,
  openAlerts: Alert[],
  chainLog: Logger,
): Promise<AlertEvent[]> {
  // Determine what we already have
  const latestDbResult = await db.latestBlockHeight();
  if (!latestDbResult.ok) {
    chainLog.error("Failed to read latest block height: %s", latestDbResult.error);
    return [];
  }

  // Get the latest committed height from RPC
  const latestCommit = await query.getLatestCommit();
  if (!latestCommit.ok) {
    chainLog.warn("Failed to get latest RPC commit: %s", latestCommit.error);
    return [];
  }

  const tipHeader = latestCommit.data.result.signedHeader.header;
  const rpcHeight = tipHeader.height;
  const tipTime = new Date(tipHeader.time);
  const dbHeight = latestDbResult.value ?? null;

  // On first run, seed from the newest settled block rather than replaying chain history. Not
  // the tip itself: the tip's commit is never canonical (see below), so seeding there would
  // stop-and-retry forever on a chain that's always one block ahead of us by the time we ask.
  const fromHeight = dbHeight != null ? Number(dbHeight) + 1 : Math.max(rpcHeight - 1, 1);

  // Validator's status as of the tip (bft only). Resolved before the commits are turned into
  // blocks: the active set cached at startup goes stale once the validator is jailed/unbonded,
  // so it is only trusted for miss attribution while the validator is still active.
  const validatorStatus = await resolveValidatorStatus(chain, query, rpcHeight, tipTime, chainLog);
  // The ongoing inactivity period doubles as the persisted last known status, used whenever the
  // live status can't be fetched (REST API down) - so a jailed validator's blocks don't turn
  // into misses just because the API is unavailable, even across restarts.
  const openInactivity = await db.getOpenInactivity();
  if (!openInactivity.ok) {
    chainLog.error("Failed to read validator inactivity: %s", openInactivity.error);
  }
  const lastKnownActive =
    validatorStatus?.active ??
    (openInactivity.ok && openInactivity.value != null ? false : undefined);
  const trustedActiveSet = lastKnownActive === false ? undefined : activeSetHex;
  if (validatorStatus != null && openInactivity.ok) {
    await recordInactivity(chain, db, validatorStatus, openInactivity.value, chainLog);
  }

  const blocks: Block[] = [];
  if (fromHeight <= rpcHeight) {
    const maxBlocksPerPoll = chain.maxBlocksPerPoll ?? DEFAULT_MAX_BLOCKS_PER_POLL;
    const toHeight = Math.min(rpcHeight, fromHeight + maxBlocksPerPoll - 1);

    // Fetch this poll's slice of missing commits
    const heights = Array.from({ length: toHeight - fromHeight + 1 }, (_, i) => fromHeight + i);
    const commits = await query.getRangeCommits(fromHeight, toHeight + 1);

    const fallbackCache: ActiveFallbackCache = {
      value: undefined,
      currentlyActive: lastKnownActive,
    };
    for (let i = 0; i < commits.length; i++) {
      const result = commits[i];
      if (!result.ok) {
        if (chain.allowBlockGaps) {
          chainLog.warn(
            "Failed to fetch commit at height %d, skipping (allowBlockGaps is set): %s",
            heights[i],
            result.error,
          );
          continue;
        }
        // Stop before this height rather than skipping it, so latestBlockHeight never advances
        // past a gap. The DB stays contiguous, and this exact height gets retried (and logged
        // again) on every subsequent poll until it succeeds or allowBlockGaps is set.
        chainLog.warn(
          `Failed to fetch commit at height ${heights[i]}, stopping this poll's ingestion here - will retry: ${result.error}`,
        );
        break;
      }
      if (result.data.result.canonical === false) {
        // This is the chain's current tip: the block is finalized, but not every validator's
        // precommit vote has necessarily reached this RPC node yet.
        // Always stop-and-retry here regardless of allowBlockGaps.
        chainLog.debug(
          "Commit at height %d is not yet canonical (tip still finalizing), stopping this poll's ingestion here - will retry",
          heights[i],
        );
        break;
      }
      try {
        blocks.push(
          await commitToBlock(
            result.data,
            chain,
            valconsHex,
            trustedActiveSet,
            query,
            fallbackCache,
            chainLog,
          ),
        );
      } catch (err) {
        if (chain.allowBlockGaps) {
          chainLog.warn(
            "Failed to parse commit into block at height %d, skipping (allowBlockGaps is set): %s",
            heights[i],
            err,
          );
          continue;
        }
        chainLog.warn(
          "Failed to parse commit into block at height %d, stopping this poll's ingestion here - will retry: %s",
          heights[i],
          err,
        );
        break;
      }
    }

    if (blocks.length > 0) {
      const ingestResult = await ingest.ingestBlocks(blocks);
      if (!ingestResult.ok) {
        chainLog.error("Block ingestion failed: %s", ingestResult.error);
      }
    }
  }

  const lastBlock = blocks[blocks.length - 1];
  const latestHeight = lastBlock != null ? lastBlock.height : (dbHeight ?? BigInt(rpcHeight));

  // Small trailing window (not the full signing window) for the consecutive-miss check, which
  // only ever looks at the last consecutiveMissAlert.threshold blocks.
  const tailSpan = BigInt(Math.max(chain.alertConfig.consecutiveMissAlert.threshold, 1) - 1);
  const tailStart = latestHeight - tailSpan > 0n ? latestHeight - tailSpan : 1n;
  const tailResult = await db.getBlockByRange(tailStart, latestHeight);
  if (!tailResult.ok) {
    chainLog.error("Failed to read consecutive-miss window: %s", tailResult.error);
    return [];
  }
  // AlertEvaluator expects ascending height order (oldest first, most recent last);
  // getBlockByRange makes no ordering guarantee, so sort explicitly rather than assuming DB
  // return order.
  const tailBlocks = [...tailResult.value].sort((a, b) => (a.height < b.height ? -1 : 1));

  // The percentageMissedBlocksAlert window can be thousands of blocks wide (a chain's
  // signed_blocks_window) - fetch only the aggregate counts, never the individual rows.
  const statsSpan = BigInt(signingWindowSize - 1);
  const statsStart = latestHeight - statsSpan > 0n ? latestHeight - statsSpan : 1n;
  const statsResult = await db.getBlockStats(statsStart, latestHeight);
  if (!statsResult.ok) {
    chainLog.error("Failed to read signing window stats: %s", statsResult.error);
    return [];
  }

  return alertEval.evaluate(
    tailBlocks,
    chain.alertConfig.consecutiveMissAlert.threshold,
    statsResult.value,
    openAlerts,
    validatorStatus,
    { height: BigInt(rpcHeight), time: tipTime },
  );
}

/** Optional observation points, used by the end-to-end tests to step through poll cycles. */
export interface ChainWorkerHooks {
  /** Called after every poll cycle finishes (successfully or not). */
  afterPoll?: () => void;
}

export async function runChainWorker(
  chain: ChainConfig,
  db: IWriteDb,
  globalAlerts: GlobalAlertsConfig,
  hooks: ChainWorkerHooks = {},
): Promise<() => void> {
  const chainLog = log.child({ chainId: chain.chainId });
  const rpcUrls = chain.rpcUrls.map((r) => r.url);
  const apiUrls = chain.apiUrls?.map((a) => a.url);

  const query = new QueryOperator(
    chain.chainId,
    chain.chainType,
    rpcUrls,
    apiUrls,
    chain.healthCheckInterval,
    undefined,
    chain.rangeChunkSize,
  );
  const ingest = new IngestLayer(db, chain.chainId);
  const alertEval = new AlertEvaluator(chain.chainId, chain.alertConfig);
  const dispatcher = new NotificationDispatcher(chain.alertConfig, globalAlerts);

  // Bech32 valcons -> hex
  const valconsHex =
    chain.chainType === "bft" && chain.valconsAddress
      ? bech32ValconsToHex(chain.valconsAddress)
      : undefined;

  const [signingWindowSize, startupHeight] = await Promise.all([
    resolveSigningWindowSize(chain, query, chainLog),
    query.getLatestCommit(),
  ]);

  const activeSetHex = startupHeight.ok
    ? await fetchActiveSetHex(
        chain,
        query,
        startupHeight.data.result.signedHeader.header.height,
        chainLog,
      )
    : undefined;

  let polling = false;

  const poll = async () => {
    if (polling) return;
    polling = true;
    try {
      await doPoll(
        chain,
        query,
        ingest,
        alertEval,
        dispatcher,
        db,
        valconsHex,
        signingWindowSize,
        activeSetHex,
      );
    } catch (err) {
      chainLog.error("Unhandled poll error: %s", err);
    } finally {
      polling = false;
      hooks.afterPoll?.();
    }
  };

  // Fire immediately, then on interval
  void poll();
  const timer = setInterval(poll, chain.pollIntervalMs ?? 6_000);
  chainLog.info("Chain worker started (interval %dms)", chain.pollIntervalMs ?? 6_000);

  return () => {
    clearInterval(timer);
    chainLog.info("Chain worker stopped");
  };
}
