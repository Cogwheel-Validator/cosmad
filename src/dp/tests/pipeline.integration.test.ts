import assert from "node:assert";
import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AxiosResponse } from "axios";
import axios from "axios";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { AlertEvaluator } from "@/alert";
import { NotificationDispatcher } from "@/alert/notifiers";
import type { ChainConfig, GlobalAlertsConfig } from "@/config/app_config";
import { IngestLayer } from "@/ingest";
import { RWDB } from "@/pkgs/database/duckdb/rw_db";
import type { IWriteDb } from "@/pkgs/database/interfaces";
import { QueryOperator } from "@/query";
import { doPoll } from "../chain_worker";

// Integration test for the full ingest pipeline: fake RPC responses (mocked axios) flow
// through the real QueryOperator -> chain_worker.doPoll -> IngestLayer -> a real (temp)
// DuckDB file, and alert evaluation drives real notifier HTTP calls (also mocked).
vi.mock("axios");

function axiosOk<T>(data: T): AxiosResponse<T> {
  return { data } as unknown as AxiosResponse<T>;
}

const testDataDir = join(import.meta.dirname, "..", "..", "query", "rpc", "tests", "test_data");
const commitFixture = JSON.parse(readFileSync(join(testDataDir, "test_commit.json"), "utf8"));

const CHAIN_ID = "test-chain-1";
const VALCONS_ADDRESS = "53BD95F452781E263D580AF4D5FE448D9C9267D3";
const VALOPER_ADDRESS = "cosmosvaloper1test";
const RPC_1 = "https://rpc1.test";
const RPC_2 = "https://rpc2.test";
const API_1 = "https://api1.test";

function hashFor(height: number): string {
  return height.toString(16).padStart(64, "0").toUpperCase();
}

// A previously-recorded valid 88-char base64 ed25519 signature, reused for every "signed" block.
const FAKE_SIGNATURE =
  "VNMOnZJIFUcZmmBSdfewTpsdAnviEL4PMcc9qaiI/z1XdP2XR4ENAoD+L4hg1FmtzlLnBWoujeJ/bwKrp5+CBw==";

function makeCommit(height: number, signed: boolean, canonical = true): unknown {
  const clone = structuredClone(commitFixture);
  const { header, commit } = clone.result.signed_header;
  header.height = String(height);
  header.chain_id = CHAIN_ID;
  header.time = new Date().toISOString();
  commit.height = String(height);
  commit.block_id.hash = hashFor(height);
  commit.signatures[0] = signed
    ? {
        block_id_flag: 2,
        validator_address: VALCONS_ADDRESS,
        timestamp: header.time,
        signature: FAKE_SIGNATURE,
      }
    : {
        block_id_flag: 1,
        validator_address: VALCONS_ADDRESS,
        timestamp: "0001-01-01T00:00:00Z",
        signature: null,
      };
  clone.result.canonical = canonical;
  return clone;
}

function makeStatus(height: number): unknown {
  return {
    jsonrpc: "2.0",
    id: -1,
    result: {
      node_info: { network: CHAIN_ID, version: "0.37.16" },
      sync_info: {
        latest_block_height: String(height),
        latest_block_time: new Date().toISOString(),
        catching_up: false,
      },
    },
  };
}

const validatorDataFixture = {
  validator: {
    operator_address: VALOPER_ADDRESS,
    consensus_pubkey: { type_url: "/cosmos.crypto.ed25519.PubKey", value: "abc123" },
    jailed: false,
    status: "BOND_STATUS_BONDED",
    tokens: "1000000",
    delegator_shares: "1000000.000000000000000000",
    description: {
      moniker: "TestValidator",
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
};

const nodeInfoFixture = {
  default_node_info: {
    protocol_version: { p2p: "8", block: "11", app: "0" },
    network: CHAIN_ID,
  },
};
const syncingFixture = { syncing: false };

// The tracked validator is always a member of the active set for this test.
// Filtering (-1 case) is covered separately in unit tests.
const valsetFixture = {
  block_height: "1",
  validators: [
    {
      address: VALCONS_ADDRESS,
      pub_key: { type_url: "/cosmos.crypto.ed25519.PubKey", value: "abc123" },
      voting_power: "1000000",
      proposer_priority: "0",
    },
  ],
  pagination: { next_key: "", total: "1" },
};

// Mutable "chain tip" the mocked RPC servers report; each poll advances it and marks which
// heights in range are signed vs missed by the tracked validator.
let currentTip = 0;
const signedByHeight = new Map<number, boolean>();
const nonCanonicalHeights = new Set<number>();

function setTip(height: number, missedRange: number[] = []) {
  currentTip = height;
  for (const h of missedRange) signedByHeight.set(h, false);
}

beforeEach(() => {
  vi.mocked(axios.get).mockImplementation(async (url: string) => {
    if (url.startsWith(RPC_1) || url.startsWith(RPC_2)) {
      if (url.includes("/commit")) {
        const match = url.match(/height=(\d+)/);
        const height = match ? Number(match[1]) : currentTip;
        return axiosOk(
          makeCommit(height, signedByHeight.get(height) ?? true, !nonCanonicalHeights.has(height)),
        );
      }
      if (url.endsWith("/status")) {
        const height = url.startsWith(RPC_1) ? currentTip - 1 : currentTip;
        return axiosOk(makeStatus(height));
      }
    }
    if (url.startsWith(API_1)) {
      if (url.includes("/node_info")) return axiosOk(nodeInfoFixture);
      if (url.includes("/syncing")) return axiosOk(syncingFixture);
      if (url.includes("/validators/")) return axiosOk(validatorDataFixture);
      if (url.includes("/validatorsets/")) return axiosOk(valsetFixture);
    }
    throw new Error(`Unexpected axios.get call in test: ${url}`);
  });
  vi.mocked(axios.post).mockResolvedValue(axiosOk({}));
  vi.mocked(axios.isAxiosError).mockImplementation((_err): _err is unknown => false);

  // Deterministically alternate the round-robin RPC pick so both endpoints get exercised.
  let call = 0;
  vi.spyOn(Math, "random").mockImplementation(() => (call++ % 2 === 0 ? 0.1 : 0.9));
});

describe("ingest pipeline integration", () => {
  const testDir = join(tmpdir(), `cosmad_test_pipeline_${Date.now()}`);
  let db: RWDB;
  let writeDb: IWriteDb;
  let chain: ChainConfig;
  let query: QueryOperator;
  let ingest: IngestLayer;
  let alertEval: AlertEvaluator;
  let dispatcher: NotificationDispatcher;

  beforeAll(async () => {
    db = await RWDB.create(testDir, { threads: "1", memoryLimit: "512MB" });
    writeDb = db.forChain(CHAIN_ID, "bft");

    chain = {
      chainId: CHAIN_ID,
      prettyName: "Test Chain",
      chainType: "bft",
      valoperAddress: VALOPER_ADDRESS,
      valconsAddress: VALCONS_ADDRESS,
      rpcUrls: [
        { url: RPC_1, alertIfDown: true },
        { url: RPC_2, alertIfDown: true },
      ],
      apiUrls: [{ url: API_1, alertIfDown: true }],
      pollIntervalMs: 6_000,
      alertConfig: {
        alertIfInactive: false,
        signingWindowSize: 20,
        stalledAlert: { enabled: false, stalledThreshold: 999_999 },
        consecutiveMissAlert: { enabled: true, threshold: 3, repeat: true, repeatInterval: 0 },
        percentageMissedBlocksAlert: { enabled: false, threshold: 50, repeat: false },
      },
    };

    query = new QueryOperator(chain.chainId, chain.chainType, [RPC_1, RPC_2], [API_1]);
    ingest = new IngestLayer(writeDb, chain.chainId);
    alertEval = new AlertEvaluator(chain.chainId, chain.alertConfig);

    const globalAlerts: GlobalAlertsConfig = {
      telegram: { enabled: true, botToken: "fake-token", chatId: "-100" },
      discord: { enabled: true, webhookUrl: "https://discord.com/api/webhooks/1/fake" },
      pagerduty: { enabled: true, serviceKey: "fake-key" },
      healthCheck: undefined,
    };
    dispatcher = new NotificationDispatcher(chain.alertConfig, globalAlerts);
  });

  afterAll(() => {
    db.close();
    rmSync(testDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  async function allBlockHeights(): Promise<number[]> {
    const result = await db.conn.runAndReadAll("SELECT height FROM blocks ORDER BY height");
    return result.getRows().map((row) => Number(row[0]));
  }

  test("first poll seeds from the current tip only - no history backfill", async () => {
    setTip(100);
    signedByHeight.set(100, true);

    await doPoll(
      chain,
      query,
      ingest,
      alertEval,
      dispatcher,
      writeDb,
      VALCONS_ADDRESS,
      20,
      undefined,
    );

    const heights = await allBlockHeights();
    expect(heights).toEqual([100]);

    const latest = await db.latestBlock(CHAIN_ID, "bft");
    assert(latest.ok);
    expect(latest.value?.hash.toString("hex").toUpperCase()).toBe(hashFor(100));
    expect(latest.value?.signed).toBe(1);
  });

  test("a gap since the last poll is fully backfilled across both RPC endpoints, and 3 consecutive misses opens an alert", async () => {
    setTip(104, [102, 103, 104]);
    signedByHeight.set(101, true);

    vi.mocked(axios.get).mockClear();

    await doPoll(
      chain,
      query,
      ingest,
      alertEval,
      dispatcher,
      writeDb,
      VALCONS_ADDRESS,
      20,
      undefined,
    );

    const heights = await allBlockHeights();
    expect(heights).toEqual([100, 101, 102, 103, 104]);

    // Both RPC endpoints were used for the gap-fill commit fetches (round-robin spread).
    const commitCalls = vi
      .mocked(axios.get)
      .mock.calls.map((c) => c[0] as string)
      .filter((url) => url.includes("/commit"));
    expect(commitCalls.some((u) => u.startsWith(RPC_1))).toBe(true);
    expect(commitCalls.some((u) => u.startsWith(RPC_2))).toBe(true);

    const unclosed = await db.getUnclosedAlerts(CHAIN_ID);
    assert(unclosed.ok);
    expect(unclosed.value).toHaveLength(1);
    expect(unclosed.value[0].alertType).toBe("consecutive_miss");
    expect(unclosed.value[0].repeatCount).toBe(0);

    // opened -> one notification per enabled channel (telegram, discord, pagerduty)
    expect(vi.mocked(axios.post)).toHaveBeenCalledTimes(3);
  });

  test("the alert still being breached on the next poll sends a repeat notification", async () => {
    vi.mocked(axios.post).mockClear();
    setTip(108, [105, 106, 107, 108]);

    await doPoll(
      chain,
      query,
      ingest,
      alertEval,
      dispatcher,
      writeDb,
      VALCONS_ADDRESS,
      20,
      undefined,
    );

    const heights = await allBlockHeights();
    expect(heights).toEqual([100, 101, 102, 103, 104, 105, 106, 107, 108]);

    const unclosed = await db.getUnclosedAlerts(CHAIN_ID);
    assert(unclosed.ok);
    expect(unclosed.value).toHaveLength(1);
    expect(unclosed.value[0].repeatCount).toBe(1);
    expect(unclosed.value[0].lastNotifiedAt).toBeInstanceOf(Date);

    expect(vi.mocked(axios.post)).toHaveBeenCalledTimes(3);
  });

  test("the validator signing again closes the alert and sends a close notification", async () => {
    vi.mocked(axios.post).mockClear();
    setTip(109);
    signedByHeight.set(109, true);

    await doPoll(
      chain,
      query,
      ingest,
      alertEval,
      dispatcher,
      writeDb,
      VALCONS_ADDRESS,
      20,
      undefined,
    );

    const heights = await allBlockHeights();
    expect(heights).toEqual([100, 101, 102, 103, 104, 105, 106, 107, 108, 109]);

    const unclosed = await db.getUnclosedAlerts(CHAIN_ID);
    assert(unclosed.ok);
    expect(unclosed.value).toHaveLength(0);

    expect(vi.mocked(axios.post)).toHaveBeenCalledTimes(3);
  });

  test("a non-canonical (still-finalizing) tip commit is not ingested; it's picked up once it settles", async () => {
    // The tip has moved to 110, and the validator did sign it - but the RPC node reports
    // canonical: false, meaning not every validator's vote has necessarily arrived here yet.
    // This must NOT be recorded as a miss.
    nonCanonicalHeights.add(110);
    setTip(110);
    signedByHeight.set(110, true);

    await doPoll(
      chain,
      query,
      ingest,
      alertEval,
      dispatcher,
      writeDb,
      VALCONS_ADDRESS,
      20,
      undefined,
    );

    let heights = await allBlockHeights();
    expect(heights).toEqual([100, 101, 102, 103, 104, 105, 106, 107, 108, 109]);
    const latestAfterNonCanonical = await db.latestBlock(CHAIN_ID, "bft");
    assert(latestAfterNonCanonical.ok);
    expect(latestAfterNonCanonical.value?.height).toBe(109n);

    // The next poll finds the same height now canonical (settled) - it gets ingested correctly.
    nonCanonicalHeights.delete(110);

    await doPoll(
      chain,
      query,
      ingest,
      alertEval,
      dispatcher,
      writeDb,
      VALCONS_ADDRESS,
      20,
      undefined,
    );

    heights = await allBlockHeights();
    expect(heights).toEqual([100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110]);
    const latest = await db.latestBlock(CHAIN_ID, "bft");
    assert(latest.ok);
    expect(latest.value?.height).toBe(110n);
    expect(latest.value?.signed).toBe(1);
  });
});
