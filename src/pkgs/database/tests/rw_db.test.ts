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
// Alert key generation
// ---------------------------------------------------------------------------

describe("Alert.generateKey", () => {
  test("is deterministic for the same inputs", () => {
    const key = Alert.generateKey("cosmos-hub", "missed_blocks");
    expect(Alert.generateKey("cosmos-hub", "missed_blocks")).toBe(key);
  });

  test("produces a 64-character hex string (SHA-256)", () => {
    const key = Alert.generateKey("cosmos-hub", "missed_blocks");
    expect(key).toHaveLength(64);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  test("differs when chainId differs", () => {
    expect(Alert.generateKey("chain-a", "missed_blocks")).not.toBe(
      Alert.generateKey("chain-b", "missed_blocks"),
    );
  });

  test("differs when alertType differs", () => {
    expect(Alert.generateKey("cosmos-hub", "missed_blocks")).not.toBe(
      Alert.generateKey("cosmos-hub", "high_latency"),
    );
  });
});

// ---------------------------------------------------------------------------
// Alerts — write + read
// ---------------------------------------------------------------------------

describe("RWDB alerts", () => {
  const alertChainId = "test-chain";
  const openKey = Alert.generateKey(alertChainId, "missed_blocks");
  const closedKey = Alert.generateKey(alertChainId, "closed_event");
  const openedAt = new Date("2026-03-01T12:00:00.000Z");

  test("getAlert returns null for a non-existent key", async () => {
    const result = await db.getAlert("unknown_key");
    expect(result.ok).toBe(true);
    assert(result.ok);
    expect(result.value).toBeNull();
  });

  test("getUnclosedAlerts returns an empty array when no alerts exist", async () => {
    const result = await db.getUnclosedAlerts(alertChainId);
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
    const result = await db.getUnclosedAlerts(alertChainId);
    expect(result.ok).toBe(true);
    assert(result.ok);
    expect(result.value).toHaveLength(1);
    expect(result.value?.[0].alertId).toBe(openKey);
  });

  test("insertAlert inserts a second open alert", async () => {
    const key2 = Alert.generateKey(alertChainId, "high_latency");
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
    const result = await db.getUnclosedAlerts(alertChainId);
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
    const result = await db.getUnclosedAlerts(alertChainId);
    expect(result.ok).toBe(true);
    assert(result.ok);
    const alertIds = result.value?.map((a) => a.alertId) ?? [];
    expect(alertIds).not.toContain(closedKey);
  });

  test("getUnclosedAlerts is scoped to the given chain", async () => {
    const otherKey = Alert.generateKey("other-alert-chain", "missed_blocks");
    await db.insertAlert(
      new Alert({
        alertId: otherKey,
        chainId: "other-alert-chain",
        alertType: "missed_blocks",
        openedAt: new Date("2026-03-01T14:00:00.000Z"),
      }),
    );

    const result = await db.getUnclosedAlerts(alertChainId);
    assert(result.ok);
    expect(result.value.map((a) => a.alertId)).not.toContain(otherKey);

    const otherResult = await db.getUnclosedAlerts("other-alert-chain");
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
