import assert from "node:assert";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { RWDB } from "../duckdb/rw_db";
import { Alert, Block } from "../tables";

const testDir = join(tmpdir(), `cosmad_test_rw_${Date.now()}`);
const chainId = "test";
let db: RWDB;

beforeAll(async () => {
  // RWDB.create initialises the schema automatically.
  const options = { threads: "2", memoryLimit: "500MB", maxTempDirectorySize: "1GB" };
  db = await RWDB.create(testDir, options);
});

afterAll(() => {
  db.close();
  rmSync(testDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

describe("RWDB blocks", () => {
  test("latestBlock returns null when no blocks exist", async () => {
    const resultBft = await db.latestBlock(chainId, "bft");
    expect(resultBft.ok).toBe(true);
    assert(resultBft.ok);
    expect(resultBft.value).toBeNull();
    const resultTm2 = await db.latestBlock(chainId, "tm2");
    expect(resultTm2.ok).toBe(true);
    assert(resultTm2.ok);
    expect(resultTm2.value).toBeNull();
  });

  test("latestBlockHeight returns null when no blocks exist", async () => {
    const result = await db.latestBlockHeight(chainId);
    expect(result.ok).toBe(true);
    assert(result.ok);
    expect(result.value).toBeNull();
  });

  test("latestBlock returns the block with the greatest height after inserts", async () => {
    await db.appendBlocks(chainId, [
      new Block({
        chainId,
        height: 1n,
        hash: "0102030405060708090a0b0c0d0e0f10",
        time: new Date("2026-01-01 00:00:00"),
        signed: 1,
        signature:
          "Ch9vbDdl+HVO0uirklBWjsuEfJ3ToXkyAxvP+/7D71wfAnq1d4I7sSlEVcoMsVrCDNY/779q7yrelQ/RRMQDAQ==",
        chainType: "bft",
      }),
      new Block({
        chainId,
        height: 2n,
        hash: "1112131415161718191a1b1c1d1e1f20",
        time: new Date("2026-01-02 00:00:00"),
        signed: 0,
        signature:
          "Ch9vbDdl+HVO0uirklBWjsuEfJ3ToXkyAxvP+/7D71wfAnq1d4I7sSlEVcoMsVrCDNY/779q7yrelQ/RRMQDAQ==",
        chainType: "bft",
      }),
      new Block({
        chainId,
        height: 3n,
        hash: "2122232425262728292a2b2c2d2e2f30",
        time: new Date("2026-01-03 00:00:00"),
        signed: 1,
        signature:
          "Ch9vbDdl+HVO0uirklBWjsuEfJ3ToXkyAxvP+/7D71wfAnq1d4I7sSlEVcoMsVrCDNY/779q7yrelQ/RRMQDAQ==",
        chainType: "bft",
      }),
    ]);

    const result = await db.latestBlock(chainId, "bft");
    expect(result.ok).toBe(true);
    assert(result.ok);
    expect(result.value).not.toBeNull();
    expect(result.value?.height).toBe(3n);
    expect(result.value?.signed).toBe(1);
  });

  test("latestBlockHeight returns the greatest height", async () => {
    const result = await db.latestBlockHeight(chainId);
    expect(result.ok).toBe(true);
    assert(result.ok);
    expect(result.value).toBe(3n);
  });

  test("appended block hash matches the hex-decoded input hash", async () => {
    const result = await db.latestBlock(chainId, "bft");
    assert(result.ok);
    expect(result.value?.hash.toString("hex")).toBe("2122232425262728292a2b2c2d2e2f30");
  });

  test("insertBlocks (parameterized fallback path) inserts blocks correctly", async () => {
    const result = await db.insertBlocks(chainId, [
      new Block({
        chainId,
        height: 4n,
        hash: "3132333435363738393a3b3c3d3e3f40",
        time: new Date("2026-01-04 00:00:00"),
        signed: 0,
        signature: undefined,
        chainType: "bft",
      }),
    ]);
    expect(result.ok).toBe(true);
    assert(result.ok);

    const latest = await db.latestBlock(chainId, "bft");
    assert(latest.ok);
    expect(latest.value?.height).toBe(4n);
    expect(latest.value?.signed).toBe(0);
    expect(latest.value?.hash.toString("hex")).toBe("3132333435363738393a3b3c3d3e3f40");
  });

  test("blocks from a different chain don't interfere with this chain's latest block", async () => {
    const signature = "dGVzdAo="; // === test
    const signBytes = Buffer.from(signature, "base64");
    await db.appendBlocks("other-chain", [
      new Block({
        chainId: "other-chain",
        height: 999n,
        hash: "4142434445464748494a4b4c4d4e4f50",
        time: new Date("2026-01-05 00:00:00"),
        signed: 1,
        signature: signature,
        chainType: "bft",
      }),
    ]);

    const result = await db.latestBlock(chainId, "bft");
    assert(result.ok);
    expect(result.value?.height).toBe(4n);

    const otherResult = await db.latestBlock("other-chain", "bft");
    assert(otherResult.ok);
    expect(otherResult.value?.height).toBe(999n);
    expect(otherResult.value?.signature).toStrictEqual(signBytes);
  });
});

// ---------------------------------------------------------------------------
// Signed-block stats (dashboard/stats API data source)
// ---------------------------------------------------------------------------

describe("RWDB signed-block stats", () => {
  const statsChainId = "stats-chain";
  const hash = "5152535455565758595a5b5c5d5e5f60";
  const signature = "dGVzdAo=";

  test("getChainSignedPercentage returns null when there are no blocks in the window", async () => {
    const result = await db.getChainSignedPercentage(statsChainId, 30);
    expect(result.ok).toBe(true);
    assert(result.ok);
    expect(result.value).toBeNull();
  });

  test("getDailySignedStats returns an empty array when there are no blocks in the window", async () => {
    const result = await db.getDailySignedStats(statsChainId, 30);
    expect(result.ok).toBe(true);
    assert(result.ok);
    expect(result.value).toEqual([]);
  });

  test("getChainSignedPercentage/getDailySignedStats aggregate recent blocks correctly", async () => {
    const now = Date.now();
    const today = new Date(now);
    const yesterday = new Date(now - 24 * 60 * 60 * 1000);
    // today: 1 signed, 1 missed, 1 not-in-active-set (excluded from total)
    // yesterday: 2 signed, 0 missed
    const signedValues: [Date, number][] = [
      [today, 1],
      [today, 0],
      [today, -1],
      [yesterday, 1],
      [yesterday, 1],
    ];
    const blocks = signedValues.map(
      ([time, signed], i) =>
        new Block({
          chainId: statsChainId,
          height: BigInt(i),
          hash,
          time,
          signed,
          signature,
          chainType: "bft",
        }),
    );
    const insertResult = await db.appendBlocks(statsChainId, blocks);
    assert(insertResult.ok);

    const percentResult = await db.getChainSignedPercentage(statsChainId, 30);
    assert(percentResult.ok);
    expect(percentResult.value).not.toBeNull();
    expect(percentResult.value?.chainId).toBe(statsChainId);
    // total = 4 (excludes the one -1), missed = 1 -> 3/4 signed, 1/4 missed
    expect(percentResult.value?.percentageSigned).toBeCloseTo(0.75);
    expect(percentResult.value?.percentageMissed).toBeCloseTo(0.25);

    const dailyResult = await db.getDailySignedStats(statsChainId, 30);
    assert(dailyResult.ok);
    expect(dailyResult.value).toHaveLength(2);
    // oldest first
    const [day1, day2] = dailyResult.value;
    expect(day1.total).toBe(2);
    expect(day1.missed).toBe(0);
    expect(day2.total).toBe(2);
    expect(day2.missed).toBe(1);
  });

  test("getDailySignedStats excludes blocks older than the requested window", async () => {
    const oldChainId = "stats-chain-old";
    const now = Date.now();
    const wayBack = new Date(now - 40 * 24 * 60 * 60 * 1000);
    const recent = new Date(now);
    await db.appendBlocks(oldChainId, [
      new Block({
        chainId: oldChainId,
        height: 0n,
        hash,
        time: wayBack,
        signed: 1,
        signature,
        chainType: "bft",
      }),
      new Block({
        chainId: oldChainId,
        height: 1n,
        hash,
        time: recent,
        signed: 1,
        signature,
        chainType: "bft",
      }),
    ]);

    const result = await db.getDailySignedStats(oldChainId, 30);
    assert(result.ok);
    expect(result.value).toHaveLength(1);
    expect(result.value[0].total).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Alert ID generation
// ---------------------------------------------------------------------------

describe("Alert.generateId", () => {
  test("produces a unique id on every call - a chain's alert type can open/close many times, and each incident needs its own row", () => {
    const a = Alert.generateId();
    const b = Alert.generateId();
    expect(a).not.toBe(b);
  });

  test("produces a non-empty string that fits the alert_id column (varchar(64))", () => {
    const id = Alert.generateId();
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
    expect(id.length).toBeLessThanOrEqual(64);
  });
});

// ---------------------------------------------------------------------------
// Alerts - write + read
// ---------------------------------------------------------------------------

describe("RWDB alerts", () => {
  const alertChainId = "test-chain";
  const openKey = Alert.generateId();
  const closedKey = Alert.generateId();
  const openedAt = new Date("2026-03-01T12:00:00.000Z");

  test("getAlert returns null for a non-existent key", async () => {
    const result = await db.getAlert("unknown_key");
    expect(result.ok).toBe(true);
    assert(result.ok);
    expect(result.value).toBeNull();
  });

  test("getUnclosedAlerts returns an empty array when no alerts exist", async () => {
    const result = await db.getUnclosedAlerts(alertChainId, 100, 1);
    expect(result.ok).toBe(true);
    assert(result.ok);
    expect(result.value).toEqual([]);
  });

  test("insertAlert inserts an open alert successfully", async () => {
    const alert = new Alert({
      alertId: openKey,
      chainId: alertChainId,
      alertType: "missed_blocks",
      openedAt,
    });
    const result = await db.insertAlert(alert);
    expect(result.ok).toBe(true);
    assert(result.ok);
  });

  test("getAlert returns the alert by its dedup key", async () => {
    const result = await db.getAlert(openKey);
    expect(result.ok).toBe(true);
    assert(result.ok);
    expect(result.value).not.toBeNull();
    expect(result.value?.alertId).toBe(openKey);
    expect(result.value?.chainId).toBe(alertChainId);
    expect(result.value?.alertType).toBe("missed_blocks");
    expect(result.value?.closedAt).toBeUndefined();
  });

  test("getUnclosedAlerts returns the open alert", async () => {
    const result = await db.getUnclosedAlerts(alertChainId, 100, 1);
    expect(result.ok).toBe(true);
    assert(result.ok);
    expect(result.value).toHaveLength(1);
    expect(result.value?.[0].alertId).toBe(openKey);
  });

  test("insertAlert inserts a second open alert", async () => {
    const key2 = Alert.generateId();
    const alert2 = new Alert({
      alertId: key2,
      chainId: alertChainId,
      alertType: "high_latency",
      openedAt: new Date("2026-03-01T13:00:00.000Z"),
    });
    const result = await db.insertAlert(alert2);
    expect(result.ok).toBe(true);
    assert(result.ok);
  });

  test("getUnclosedAlerts returns all open alerts ordered oldest-first", async () => {
    const result = await db.getUnclosedAlerts(alertChainId, 100, 1);
    expect(result.ok).toBe(true);
    assert(result.ok);
    expect(result.value?.length).toBe(2);
    const times = result.value?.map((a) => a.openedAt.getTime()) ?? [];
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  test("insertAlert inserts an already-closed alert", async () => {
    const alert = new Alert({
      alertId: closedKey,
      chainId: alertChainId,
      alertType: "closed_event",
      openedAt: new Date("2026-03-01T08:00:00.000Z"),
      closedAt: new Date("2026-03-01T09:00:00.000Z"),
    });
    const result = await db.insertAlert(alert);
    expect(result.ok).toBe(true);
    assert(result.ok);
  });

  test("getUnclosedAlerts excludes closed alerts", async () => {
    const result = await db.getUnclosedAlerts(alertChainId, 100, 1);
    expect(result.ok).toBe(true);
    assert(result.ok);
    const alertIds = result.value?.map((a) => a.alertId) ?? [];
    expect(alertIds).not.toContain(closedKey);
  });

  test("getUnclosedAlerts is scoped to the given chain", async () => {
    const otherKey = Alert.generateId();
    await db.insertAlert(
      new Alert({
        alertId: otherKey,
        chainId: "other-alert-chain",
        alertType: "missed_blocks",
        openedAt: new Date("2026-03-01T14:00:00.000Z"),
      }),
    );

    const result = await db.getUnclosedAlerts(alertChainId, 100, 1);
    assert(result.ok);
    expect(result.value.map((a) => a.alertId)).not.toContain(otherKey);

    const otherResult = await db.getUnclosedAlerts("other-alert-chain", 100, 1);
    assert(otherResult.ok);
    expect(otherResult.value.map((a) => a.alertId)).toContain(otherKey);
  });

  test("getAlert retrieves a closed alert and includes its closedAt date", async () => {
    const result = await db.getAlert(closedKey);
    expect(result.ok).toBe(true);
    assert(result.ok);
    expect(result.value?.closedAt).toBeInstanceOf(Date);
    expect(result.value?.closedAt?.toISOString()).toBe("2026-03-01T09:00:00.000Z");
  });

  test("closeAlert sets closedAt on a previously open alert", async () => {
    const closeResult = await db.closeAlert(openKey, new Date("2026-03-02T00:00:00.000Z"));
    expect(closeResult.ok).toBe(true);
    assert(closeResult.ok);

    const result = await db.getAlert(openKey);
    assert(result.ok);
    expect(result.value?.closedAt?.toISOString()).toBe("2026-03-02T00:00:00.000Z");
  });

  test("closeAlert with an alert id containing a quote does not break the query", async () => {
    const trickyKey = "not' OR '1'='1";
    const alert = new Alert({
      alertId: trickyKey,
      chainId: alertChainId,
      alertType: "sql_injection_probe",
      openedAt: new Date("2026-03-01T10:00:00.000Z"),
    });
    await db.insertAlert(alert);

    const closeResult = await db.closeAlert(trickyKey, new Date("2026-03-03T00:00:00.000Z"));
    expect(closeResult.ok).toBe(true);
    assert(closeResult.ok);

    const result = await db.getAlert(trickyKey);
    assert(result.ok);
    expect(result.value?.closedAt?.toISOString()).toBe("2026-03-03T00:00:00.000Z");

    // Confirm the injection attempt did not close every other alert as a side effect.
    const other = await db.getAlert(closedKey);
    assert(other.ok);
    expect(other.value?.closedAt?.toISOString()).toBe("2026-03-01T09:00:00.000Z");
  });
});
