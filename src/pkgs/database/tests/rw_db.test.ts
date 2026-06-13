import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { RWDB } from "../duckdb/rw_db";
import { Alert, Block } from "../tables";

const testDir = join(tmpdir(), `cosmad_test_rw_${Date.now()}`);
let db: RWDB;

beforeAll(async () => {
  // RWDB.create initialises the schema automatically.
  db = await RWDB.create(testDir, "test");
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
    const result = await db.latestBlock();
    expect(result.success).toBe(true);
    expect(result.result).toBeNull();
  });

  test("latestBlockHeight returns null when no blocks exist", async () => {
    const result = await db.latestBlockHeight();
    expect(result.success).toBe(true);
    expect(result.result).toBeNull();
  });

  test("latestBlock returns the block with the greatest height after inserts", async () => {
    await db.appendBlocks([
      new Block({
        height: 1n,
        hash: "0102030405060708090a0b0c0d0e0f10",
        time: new Date("2026-01-01 00:00:00"),
        signed: true,
        signature:
          "Ch9vbDdl+HVO0uirklBWjsuEfJ3ToXkyAxvP+/7D71wfAnq1d4I7sSlEVcoMsVrCDNY/779q7yrelQ/RRMQDAQ==",
        chainType: "bft",
      }),
      new Block({
        height: 2n,
        hash: "1112131415161718191a1b1c1d1e1f20",
        time: new Date("2026-01-02 00:00:00"),
        signed: false,
        signature:
          "Ch9vbDdl+HVO0uirklBWjsuEfJ3ToXkyAxvP+/7D71wfAnq1d4I7sSlEVcoMsVrCDNY/779q7yrelQ/RRMQDAQ==",
        chainType: "bft",
      }),
      new Block({
        height: 3n,
        hash: "2122232425262728292a2b2c2d2e2f30",
        time: new Date("2026-01-03 00:00:00"),
        signed: true,
        signature:
          "Ch9vbDdl+HVO0uirklBWjsuEfJ3ToXkyAxvP+/7D71wfAnq1d4I7sSlEVcoMsVrCDNY/779q7yrelQ/RRMQDAQ==",
        chainType: "bft",
      }),
    ]);

    const result = await db.latestBlock();
    expect(result.success).toBe(true);
    expect(result.result).not.toBeNull();
    expect(result.result?.height).toBe(3n);
    expect(result.result?.signed).toBe(true);
  });

  test("latestBlockHeight returns the greatest height", async () => {
    const result = await db.latestBlockHeight();
    expect(result.success).toBe(true);
    expect(result.result).toBe(3n);
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
  const chainId = "test-chain";
  const openKey = Alert.generateKey(chainId, "missed_blocks");
  const closedKey = Alert.generateKey(chainId, "closed_event");
  const openedAt = new Date("2026-03-01T12:00:00.000Z");

  test("getAlert returns null for a non-existent key", async () => {
    const result = await db.getAlert("unknown_key");
    expect(result.success).toBe(true);
    expect(result.result).toBeNull();
  });

  test("getUnclosedAlerts returns an empty array when no alerts exist", async () => {
    const result = await db.getUnclosedAlerts();
    expect(result.success).toBe(true);
    expect(result.result).toEqual([]);
  });

  test("insertAlert inserts an open alert successfully", async () => {
    const alert = new Alert({ alertId: openKey, chainId, alertType: "missed_blocks", openedAt });
    const result = await db.insertAlert(alert);
    expect(result.success).toBe(true);
  });

  test("getAlert returns the alert by its dedup key", async () => {
    const result = await db.getAlert(openKey);
    expect(result.success).toBe(true);
    expect(result.result).not.toBeNull();
    expect(result.result?.alertId).toBe(openKey);
    expect(result.result?.chainId).toBe(chainId);
    expect(result.result?.alertType).toBe("missed_blocks");
    expect(result.result?.closedAt).toBeUndefined();
  });

  test("getUnclosedAlerts returns the open alert", async () => {
    const result = await db.getUnclosedAlerts();
    expect(result.success).toBe(true);
    expect(result.result).toHaveLength(1);
    expect(result.result?.[0].alertId).toBe(openKey);
  });

  test("insertAlert inserts a second open alert", async () => {
    const key2 = Alert.generateKey(chainId, "high_latency");
    const alert2 = new Alert({
      alertId: key2,
      chainId,
      alertType: "high_latency",
      openedAt: new Date("2026-03-01T13:00:00.000Z"),
    });
    const result = await db.insertAlert(alert2);
    expect(result.success).toBe(true);
  });

  test("getUnclosedAlerts returns all open alerts ordered oldest-first", async () => {
    const result = await db.getUnclosedAlerts();
    expect(result.success).toBe(true);
    expect(result.result?.length).toBe(2);
    const times = result.result?.map((a) => a.openedAt.getTime()) ?? [];
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  test("insertAlert inserts an already-closed alert", async () => {
    const alert = new Alert({
      alertId: closedKey,
      chainId,
      alertType: "closed_event",
      openedAt: new Date("2026-03-01T08:00:00.000Z"),
      closedAt: new Date("2026-03-01T09:00:00.000Z"),
    });
    const result = await db.insertAlert(alert);
    expect(result.success).toBe(true);
  });

  test("getUnclosedAlerts excludes closed alerts", async () => {
    const result = await db.getUnclosedAlerts();
    expect(result.success).toBe(true);
    const alertIds = result.result?.map((a) => a.alertId) ?? [];
    expect(alertIds).not.toContain(closedKey);
  });

  test("getAlert retrieves a closed alert and includes its closedAt date", async () => {
    const result = await db.getAlert(closedKey);
    expect(result.success).toBe(true);
    expect(result.result?.closedAt).toBeInstanceOf(Date);
    expect(result.result?.closedAt?.toISOString()).toBe("2026-03-01T09:00:00.000Z");
  });
});
