import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { bech32 } from "bech32";

// Public ed25519 consensus key of the fake validator - not a secret.
const VALIDATOR_PUBKEY = "klrLNXxxcXx1v0Rvelj9ZEjarP8GXveORFSlGJlwAQM="; // gitleaks:allow

/**
 * A fully in-memory fake Cosmos (CometBFT + Cosmos SDK REST) chain, served over real HTTP on
 * 127.0.0.1. Nothing advances on its own: the test decides when blocks are produced, whether the
 * tracked validator signs them, and what happens to the validator (jail, tombstone, unbond) or
 * to the endpoints (down, halted).
 *
 * The response shapes intentionally mirror what real nodes return (checked against live
 * cosmoshub-4 endpoints), including the details cosmad has to cope with:
 *  - `/commit` for the current tip reports `canonical: false`, every older height `true`.
 *  - An absent (missed) vote is an entry with `block_id_flag: 1` and an EMPTY validator address,
 *    so a miss can't be attributed by address - only by active-set membership.
 *  - A validator outside the active set has no entry in the commit at all.
 *  - `/cosmos/base/tendermint/v1beta1/validatorsets/{height}` returns bech32 `...valcons1...`
 *    addresses, not the hex form used inside commits.
 *  - `/cosmos/staking/v1beta1/validators/{valoper}` honors the `x-cosmos-block-height` header.
 */

export type BondStatus = "BOND_STATUS_BONDED" | "BOND_STATUS_UNBONDING" | "BOND_STATUS_UNBONDED";

export interface ValidatorState {
  jailed: boolean;
  tombstoned: boolean;
  status: BondStatus;
}

interface FakeBlock {
  height: number;
  time: Date;
  /** Snapshot of the tracked validator's state when this block was produced. */
  validator: ValidatorState;
  /** Only meaningful while the validator is in the active set. */
  signed: boolean;
}

export interface FakeChainOptions {
  chainId?: string;
  bech32Prefix?: string;
  /** Hex consensus address of the tracked validator (40 hex chars). */
  valconsHex?: string;
  signedBlocksWindow?: number;
  /** Number of independent RPC / REST API nodes served (each with its own URL). Default 1. */
  rpcNodes?: number;
  apiNodes?: number;
}

export interface ProduceOptions {
  /** Whether the tracked validator signs the produced blocks. Defaults to true. */
  signed?: boolean;
  /** Block time of the produced blocks. Defaults to now. */
  time?: Date;
}

// Another validator that always signs, so every commit has a realistic majority.
const OTHER_VALIDATOR_HEX = "56B2F053AD136642D3FC9098FB2DD01454F396D5";
const FAKE_SIGNATURE =
  "VNMOnZJIFUcZmmBSdfewTpsdAnviEL4PMcc9qaiI/z1XdP2XR4ENAoD+L4hg1FmtzlLnBWoujeJ/bwKrp5+CBw==";
const ZERO_TIME = "0001-01-01T00:00:00Z";
const EMPTY_HASH = "E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855";

/** Writes a JSON response. Returns undefined so handlers can `return send(...)`. */
type Send = (status: number, body: unknown) => undefined;

function hashFor(height: number): string {
  return height.toString(16).padStart(64, "0").toUpperCase();
}

function isActive(v: ValidatorState): boolean {
  return !v.jailed && v.status === "BOND_STATUS_BONDED";
}

export class FakeChain {
  readonly chainId: string;
  readonly valconsHex: string;
  readonly valconsAddress: string;
  readonly valoperAddress: string;
  readonly otherValconsAddress: string;
  signedBlocksWindow: number;

  /** When true every RPC request fails with HTTP 503 (all RPC nodes down). */
  rpcDown = false;
  /** When true every REST request fails with HTTP 503 (all API nodes down). */
  apiDown = false;
  /** Indexes of individual RPC / API nodes that are down (HTTP 503). */
  readonly downRpcNodes = new Set<number>();
  readonly downApiNodes = new Set<number>();
  /** Indexes of RPC nodes that report `catching_up: true` (reachable, but not usable). */
  readonly catchingUpRpcNodes = new Set<number>();

  private blocks = new Map<number, FakeBlock>();
  private tip = 0;
  private validator: ValidatorState = {
    jailed: false,
    tombstoned: false,
    status: "BOND_STATUS_BONDED",
  };
  private server: Server | undefined;
  private requestLog: string[] = [];

  readonly rpcUrls: string[] = [];
  readonly apiUrls: string[] = [];
  private rpcNodes: number;
  private apiNodes: number;

  /** URL of the first RPC / API node. */
  get rpcUrl(): string {
    return this.rpcUrls[0] ?? "";
  }

  get apiUrl(): string {
    return this.apiUrls[0] ?? "";
  }

  constructor(opts: FakeChainOptions = {}) {
    const prefix = opts.bech32Prefix ?? "cosmos";
    this.chainId = opts.chainId ?? "fake-chain-1";
    this.valconsHex = (opts.valconsHex ?? "53BD95F452781E263D580AF4D5FE448D9C9267D3").toUpperCase();
    this.valconsAddress = bech32.encode(
      `${prefix}valcons`,
      bech32.toWords(Buffer.from(this.valconsHex, "hex")),
    );
    this.otherValconsAddress = bech32.encode(
      `${prefix}valcons`,
      bech32.toWords(Buffer.from(OTHER_VALIDATOR_HEX, "hex")),
    );
    this.valoperAddress = bech32.encode(
      `${prefix}valoper`,
      bech32.toWords(Buffer.from(this.valconsHex, "hex")),
    );
    this.signedBlocksWindow = opts.signedBlocksWindow ?? 100;
    this.rpcNodes = opts.rpcNodes ?? 1;
    this.apiNodes = opts.apiNodes ?? 1;
  }

  // ---- scenario controls -------------------------------------------------------------------

  /** Produces `count` new blocks on top of the current tip. Returns the new tip height. */
  produce(count = 1, opts: ProduceOptions = {}): number {
    for (let i = 0; i < count; i++) {
      this.tip++;
      this.blocks.set(this.tip, {
        height: this.tip,
        time: opts.time ?? new Date(),
        validator: { ...this.validator },
        signed: opts.signed ?? true,
      });
    }
    return this.tip;
  }

  /** Validator gets jailed (e.g. for downtime): drops out of the active set. */
  jail(): void {
    this.validator = { ...this.validator, jailed: true, status: "BOND_STATUS_UNBONDING" };
  }

  /** Validator unjails and re-enters the active set. */
  unjail(): void {
    if (this.validator.tombstoned) throw new Error("A tombstoned validator can never unjail");
    this.validator = { ...this.validator, jailed: false, status: "BOND_STATUS_BONDED" };
  }

  /** Double-sign: validator is jailed forever and tombstoned. */
  tombstone(): void {
    this.validator = { jailed: true, tombstoned: true, status: "BOND_STATUS_UNBONDING" };
  }

  /** Validator is not jailed but has fallen out of the active set (e.g. not enough stake). */
  dropFromActiveSet(): void {
    this.validator = { ...this.validator, jailed: false, status: "BOND_STATUS_UNBONDED" };
  }

  /** Validator re-enters the active set (not jailed). */
  joinActiveSet(): void {
    this.validator = { ...this.validator, jailed: false, status: "BOND_STATUS_BONDED" };
  }

  get validatorState(): ValidatorState {
    return { ...this.validator };
  }

  get height(): number {
    return this.tip;
  }

  /** Every request path (with query, plus `@height=N` if the height header was set), in order. */
  get requests(): readonly string[] {
    return this.requestLog;
  }

  // ---- server lifecycle --------------------------------------------------------------------

  async start(): Promise<void> {
    this.server = createServer((req, res) => {
      this.handle(req, res).catch((err: unknown) => {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: String(err) }));
      });
    });
    await new Promise<void>((resolve) => this.server?.listen(0, "127.0.0.1", resolve));
    const { port } = this.server.address() as AddressInfo;
    this.rpcUrls.length = 0;
    this.apiUrls.length = 0;
    for (let i = 0; i < this.rpcNodes; i++) this.rpcUrls.push(`http://127.0.0.1:${port}/rpc-${i}`);
    for (let i = 0; i < this.apiNodes; i++) this.apiUrls.push(`http://127.0.0.1:${port}/api-${i}`);
  }

  async stop(): Promise<void> {
    const server = this.server;
    if (server == null) return;
    this.server = undefined;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  // ---- request handling --------------------------------------------------------------------

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<undefined> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const heightHeader = req.headers["x-cosmos-block-height"];
    this.requestLog.push(
      url.pathname +
        url.search +
        (typeof heightHeader === "string" ? `@height=${heightHeader}` : ""),
    );

    const send: Send = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
      return undefined;
    };

    const node = url.pathname.match(/^\/(rpc|api)-(\d+)(\/.*)$/);
    const [, kind, indexStr, path = "/"] = node ?? [];
    const index = Number(indexStr);
    if (kind === "rpc") {
      if (this.rpcDown || this.downRpcNodes.has(index)) return send(503, { error: "rpc down" });
      return this.handleRpc(path, url, index, send);
    }
    if (kind === "api") {
      if (this.apiDown || this.downApiNodes.has(index)) {
        return send(503, { code: 14, message: "api down", details: [] });
      }
      const height = typeof heightHeader === "string" ? Number(heightHeader) : undefined;
      return this.handleApi(path, height, send);
    }
    send(404, { error: "not found" });
  }

  private handleRpc(path: string, url: URL, node: number, send: Send): undefined {
    if (path === "/status") {
      const tip = this.blocks.get(this.tip);
      return send(200, {
        jsonrpc: "2.0",
        id: -1,
        result: {
          node_info: { network: this.chainId, version: "0.38.17" },
          sync_info: {
            latest_block_height: String(this.tip),
            latest_block_time: (tip?.time ?? new Date()).toISOString(),
            catching_up: this.catchingUpRpcNodes.has(node),
          },
        },
      });
    }
    if (path === "/commit") {
      const heightParam = url.searchParams.get("height");
      const height = heightParam != null ? Number(heightParam) : this.tip;
      const block = this.blocks.get(height);
      if (block == null) {
        return send(200, {
          jsonrpc: "2.0",
          id: -1,
          error: {
            code: -32603,
            message: "Internal error",
            data: `height ${height} must be less than or equal to the current blockchain height ${this.tip}`,
          },
        });
      }
      return send(200, this.commitResponse(block));
    }
    send(404, { error: `unknown rpc path ${path}` });
  }

  private commitResponse(block: FakeBlock): unknown {
    const time = block.time.toISOString();
    const signatures: unknown[] = [
      {
        block_id_flag: 2,
        validator_address: OTHER_VALIDATOR_HEX,
        timestamp: time,
        signature: FAKE_SIGNATURE,
      },
    ];
    if (isActive(block.validator)) {
      signatures.push(
        block.signed
          ? {
              block_id_flag: 2,
              validator_address: this.valconsHex,
              timestamp: time,
              signature: FAKE_SIGNATURE,
            }
          : // Real CometBFT absent vote: no address, no signature.
            { block_id_flag: 1, validator_address: "", timestamp: ZERO_TIME, signature: null },
      );
    }
    const blockId = { hash: hashFor(block.height), parts: { total: 1, hash: EMPTY_HASH } };
    return {
      jsonrpc: "2.0",
      id: -1,
      result: {
        signed_header: {
          header: {
            version: { block: "11" },
            chain_id: this.chainId,
            height: String(block.height),
            time,
            last_block_id: {
              hash: hashFor(block.height - 1),
              parts: { total: 1, hash: EMPTY_HASH },
            },
            last_commit_hash: EMPTY_HASH,
            data_hash: EMPTY_HASH,
            validators_hash: EMPTY_HASH,
            next_validators_hash: EMPTY_HASH,
            consensus_hash: EMPTY_HASH,
            app_hash: EMPTY_HASH,
            last_results_hash: EMPTY_HASH,
            evidence_hash: EMPTY_HASH,
            proposer_address: OTHER_VALIDATOR_HEX,
          },
          commit: {
            height: String(block.height),
            round: 0,
            block_id: blockId,
            signatures,
          },
        },
        // The tip's commit is the node's own "seen" commit, not yet included in a later block.
        canonical: block.height < this.tip,
      },
    };
  }

  /** Validator state as of `height` (or now, for no/unknown height). */
  private validatorAt(height: number | undefined): ValidatorState {
    if (height == null || Number.isNaN(height)) return this.validator;
    return this.blocks.get(height)?.validator ?? this.validator;
  }

  private handleApi(path: string, height: number | undefined, send: Send): undefined {
    if (path === "/cosmos/base/tendermint/v1beta1/node_info") {
      return send(200, {
        default_node_info: {
          protocol_version: { p2p: "8", block: "11", app: "0" },
          network: this.chainId,
          version: "0.38.17",
        },
      });
    }
    if (path === "/cosmos/base/tendermint/v1beta1/syncing") {
      return send(200, { syncing: false });
    }
    if (path === "/cosmos/slashing/v1beta1/params") {
      return send(200, {
        params: {
          signed_blocks_window: String(this.signedBlocksWindow),
          min_signed_per_window: "0.050000000000000000",
          downtime_jail_duration: "600s",
          slash_fraction_double_sign: "0.050000000000000000",
          slash_fraction_downtime: "0.000100000000000000",
        },
      });
    }
    const valsetMatch = path.match(/^\/cosmos\/base\/tendermint\/v1beta1\/validatorsets\/(\w+)$/);
    if (valsetMatch) {
      const h = valsetMatch[1] === "latest" ? this.tip : Number(valsetMatch[1]);
      const validators = [this.valsetEntry(this.otherValconsAddress)];
      if (isActive(this.validatorAt(h))) validators.push(this.valsetEntry(this.valconsAddress));
      return send(200, {
        block_height: String(h),
        validators,
        pagination: { next_key: null, total: String(validators.length) },
      });
    }
    const signingInfoMatch = path.match(/^\/cosmos\/slashing\/v1beta1\/signing_infos\/(\w+)$/);
    if (signingInfoMatch) {
      const v = this.validatorAt(height);
      return send(200, {
        val_signing_info: {
          address: this.valconsAddress,
          start_height: "1",
          index_offset: String(this.tip),
          jailed_until: v.jailed
            ? v.tombstoned
              ? "9999-12-31T23:59:59.999999999Z"
              : new Date(Date.now() + 600_000).toISOString()
            : "1970-01-01T00:00:00Z",
          // Real nodes may omit zero values - only present when true.
          ...(v.tombstoned ? { tombstoned: true } : {}),
          missed_blocks_counter: "0",
        },
      });
    }
    const validatorMatch = path.match(/^\/cosmos\/staking\/v1beta1\/validators\/(\w+)$/);
    if (validatorMatch) {
      if (validatorMatch[1] !== this.valoperAddress) {
        return send(404, { code: 5, message: "validator not found", details: [] });
      }
      const v = this.validatorAt(height);
      return send(200, {
        validator: {
          operator_address: this.valoperAddress,
          consensus_pubkey: {
            "@type": "/cosmos.crypto.ed25519.PubKey",
            key: VALIDATOR_PUBKEY,
          },
          jailed: v.jailed,
          status: v.status,
          tokens: "1000000",
          delegator_shares: "1000000.000000000000000000",
          description: {
            moniker: "FakeValidator",
            identity: "",
            website: "",
            security_contact: "",
            details: "",
          },
          unbonding_height: "0",
          unbonding_time: "1970-01-01T00:00:00Z",
          commission: {
            commission_rates: { rate: "0.05", max_rate: "0.20", max_change_rate: "0.01" },
            update_time: "1970-01-01T00:00:00Z",
          },
          min_self_delegation: "1",
          unbonding_on_hold_ref_count: "0",
          unbonding_ids: [],
        },
      });
    }
    send(501, { code: 12, message: `Not Implemented: ${path}`, details: [] });
  }

  private valsetEntry(address: string): unknown {
    return {
      address,
      pub_key: {
        "@type": "/cosmos.crypto.ed25519.PubKey",
        key: VALIDATOR_PUBKEY,
      },
      voting_power: "1000000",
      proposer_priority: "0",
    };
  }
}
