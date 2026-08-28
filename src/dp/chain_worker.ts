import type { Logger } from "pino";
import { AlertEvaluator } from "@/alert";
import { NotificationDispatcher } from "@/alert/notifiers";
import type { ChainConfig, GlobalAlertsConfig } from "@/config/app_config";
import { IngestLayer } from "@/ingest";
import { bech32ValconsToHex } from "@/pkgs/address/valcons";
import type { IWriteDb } from "@/pkgs/database/interfaces";
import { Block } from "@/pkgs/database/tables";
import logger from "@/pkgs/logger";
import { QueryOperator } from "@/query";
import type { BlockCommitResponse } from "@/query/rpc/types";

const log = logger.child({ module: "ChainWorker" });

// Used when a chain has no configured signingWindowSize and (for bft) the chain's own
// signed_blocks_window couldn't be fetched. Matches a common Cosmos SDK default.
const DEFAULT_SIGNING_WINDOW_SIZE = 10_000;

// Used when a chain has no configured maxBlocksPerPoll.
const DEFAULT_MAX_BLOCKS_PER_POLL = 100;

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
  return new Set(valsetResult.data.validators.map((v) => v.address.toUpperCase()));
}

/** Mutable, memoized within a single poll cycle. */
interface ActiveFallbackCache {
  value: boolean | undefined;
}

/**
 * Instead of re-fetching the whole valset, this queries the single-validator
 * REST endpoint at the commit's own height (via the x-cosmos-block-height header). Should be much
 * cheaper since we only pull one validator's data.
 */
async function resolveActiveFallback(
  chain: ChainConfig,
  query: QueryOperator,
  height: number,
  cache: ActiveFallbackCache,
  chainLog: Logger,
): Promise<boolean> {
  if (cache.value !== undefined) return cache.value;
  const valData = await query.getValidatorData(chain.valoperAddress, height);
  if (valData.ok) {
    const { jailed, status } = valData.data.validator;
    cache.value = !jailed && status === "BOND_STATUS_BONDED";
  } else {
    chainLog.warn("Failed to confirm active-set status, assuming active: %s", valData.error);
    cache.value = true;
  }
  return cache.value;
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

  let signed: number;
  let signature: string | undefined;

  if ("signatures" in commitData && commitData.signatures != null) {
    // Cosmos BFT path - identify validator by hex consensus address
    const sig = commitData.signatures.find((s) => s != null && s.validatorAddress === valconsHex);
    if (sig != null) {
      signed = sig.blockIdFlag === 2 ? 1 : 0;
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
    // TM2 path - identify validator by operator address, no active-set option
    const addr = chain.valoperAddress;
    const pre = commitData.precommits.find((p) => p != null && p.validatorAddress === addr);
    signed = pre != null && pre.type === 2 ? 1 : 0;
    if (signed === 1 && pre?.signature != null) signature = pre.signature;
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
  });
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

  // Determine what we already have
  const latestDbResult = await db.latestBlockHeight();
  if (!latestDbResult.ok) {
    chainLog.error("Failed to read latest block height: %s", latestDbResult.error);
    return;
  }

  // Get the latest committed height from RPC
  const latestCommit = await query.getLatestCommit();
  if (!latestCommit.ok) {
    chainLog.warn("Failed to get latest RPC commit: %s", latestCommit.error);
    return;
  }

  const rpcHeight = latestCommit.data.result.signedHeader.header.height;
  const dbHeight = latestDbResult.value ?? null;

  // On first run, seed from the current tip rather than replaying chain history
  const fromHeight = dbHeight != null ? Number(dbHeight) + 1 : rpcHeight;

  const blocks: Block[] = [];
  if (fromHeight <= rpcHeight) {
    const maxBlocksPerPoll = chain.maxBlocksPerPoll ?? DEFAULT_MAX_BLOCKS_PER_POLL;
    const toHeight = Math.min(rpcHeight, fromHeight + maxBlocksPerPoll - 1);

    // Fetch this poll's slice of missing commits
    const heights = Array.from({ length: toHeight - fromHeight + 1 }, (_, i) => fromHeight + i);
    const commits = await query.getRangeCommits(fromHeight, toHeight + 1);

    const fallbackCache: ActiveFallbackCache = { value: undefined };
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
          "Failed to fetch commit at height %d, stopping this poll's ingestion here - will retry: %s",
          heights[i],
          result.error,
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
            activeSetHex,
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

  // Evaluate alert conditions against the freshly ingested blocks
  const openAlertsResult = await db.getUnclosedAlerts();
  if (!openAlertsResult.ok) {
    chainLog.error("Failed to read open alerts: %s", openAlertsResult.error);
    return;
  }

  // Determine validator active status (BFT only via REST API)
  let validatorActive = true;
  if (chain.chainType === "bft") {
    const valData = await query.getValidatorData(chain.valoperAddress);
    if (valData.ok) {
      const { jailed, status } = valData.data.validator;
      validatorActive = !jailed && status === "BOND_STATUS_BONDED";
    }
  }

  const lastBlock = blocks[blocks.length - 1];
  const latestHeight = lastBlock != null ? lastBlock.height : (dbHeight ?? BigInt(rpcHeight));

  // Did cosmad caught up?
  const caughtUp = latestHeight >= BigInt(rpcHeight);

  // Small trailing window (not the full signing window) for the stalled/consecutive-miss
  // checks, which only ever look at the last consecutiveMissAlert.threshold blocks.
  const tailSpan = BigInt(Math.max(chain.alertConfig.consecutiveMissAlert.threshold, 1) - 1);
  const tailStart = latestHeight - tailSpan > 0n ? latestHeight - tailSpan : 1n;
  const tailResult = await db.getBlockByRange(tailStart, latestHeight);
  if (!tailResult.ok) {
    chainLog.error("Failed to read consecutive-miss window: %s", tailResult.error);
    return;
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
    return;
  }

  const events = alertEval.evaluate(
    tailBlocks,
    chain.alertConfig.consecutiveMissAlert.threshold,
    statsResult.value,
    openAlertsResult.value,
    validatorActive,
    caughtUp,
  );
  for (const event of events) {
    if (event.kind === "open") {
      const r = await ingest.ingestAlert(event.alert);
      if (!r.ok) chainLog.error("Failed to insert alert %s: %s", event.alert.alertId, r.error);
      await dispatcher.dispatch(event, chain.chainId);
    } else if (event.kind === "repeat") {
      const r = await db.touchAlertNotified(
        event.alert.alertId,
        new Date(),
        event.alert.repeatCount + 1,
      );
      if (!r.ok) chainLog.error("Failed to touch alert %s: %s", event.alert.alertId, r.error);
      await dispatcher.dispatch(event, chain.chainId);
    } else {
      const r = await ingest.closeAlert(event.alert.alertId, event.closedAt);
      if (!r.ok) chainLog.error("Failed to close alert %s: %s", event.alert.alertId, r.error);
      await dispatcher.dispatch(event, chain.chainId);
    }
  }
}

export async function runChainWorker(
  chain: ChainConfig,
  db: IWriteDb,
  globalAlerts: GlobalAlertsConfig,
): Promise<() => void> {
  const chainLog = log.child({ chainId: chain.chainId });
  const rpcUrls = chain.rpcUrls.map((r) => r.url);
  const apiUrls = chain.apiUrls?.map((a) => a.url);

  const query = new QueryOperator(
    chain.chainId,
    chain.chainType,
    rpcUrls,
    apiUrls,
    undefined,
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

  const signingWindowSize = await resolveSigningWindowSize(chain, query, chainLog);

  // Fetched once at startup
  const startupHeight = await query.getLatestCommit();
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
