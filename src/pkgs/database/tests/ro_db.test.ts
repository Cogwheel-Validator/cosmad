import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { RODB } from "../duckdb/ro_db";
import { RWDB } from "../duckdb/rw_db";
import { Alert } from "../tables";

/**
 * RODB is READ_ONLY, so we seed the database with RWDB first, close the
 * write connection, and then open RODB against the same file.
 * RWDB.create handles schema initialisation automatically.
 */

const testDir = join(tmpdir(), `cosmad_test_ro_${Date.now()}`);
let rodb: RODB;

const chainId = "test-chain";
const openKey = Alert.generateKey(chainId, "missed_blocks");
const closedKey = Alert.generateKey(chainId, "node_down");

beforeAll(async () => {
  const rwdb = await RWDB.create(testDir, "test");

  await rwdb.conn.run(`
    INSERT INTO blocks VALUES
      (10, '\\x0102030405060708090a0b0c0d0e0f10'::BLOB, '2026-06-01 00:00:00', true,  NULL),
      (20, '\\x1112131415161718191a1b1c1d1e1f20'::BLOB, '2026-06-02 00:00:00', false, NULL),
      (30, '\\x2122232425262728292a2b2c2d2e2f30'::BLOB, '2026-06-03 00:00:00', true,  NULL)
  `);

  await rwdb.insertAlert(
    new Alert({
      alertId: openKey,
      chainId,
      alertType: "missed_blocks",
      openedAt: new Date("2026-05-01T10:00:00.000Z"),
    }),
  );
  await rwdb.insertAlert(
    new Alert({
      alertId: closedKey,
      chainId,
      alertType: "node_down",
      openedAt: new Date("2026-05-01T08:00:00.000Z"),
      closedAt: new Date("2026-05-01T09:00:00.000Z"),
    }),
  );

  // Close the write connection before opening read-only.
  rwdb.close();

  rodb = await RODB.create(testDir, "test");
});

afterAll(() => {
  rodb.close();
  rmSync(testDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

describe("RODB blocks", () => {
  test("latestBlock returns the block with the highest height", async () => {
    const result = await rodb.latestBlock();
    expect(result.success).toBe(true);
    expect(result.result).not.toBeNull();
    expect(result.result?.height).toBe(30n);
    expect(result.result?.signed).toBe(true);
  });

  test("latestBlockHeight returns the correct height as bigint", async () => {
    const result = await rodb.latestBlockHeight();
    expect(result.success).toBe(true);
    expect(result.result).toBe(30n);
  });

  test("latestBlock exposes block fields correctly", async () => {
    const result = await rodb.latestBlock();
    expect(result.result?.hash).toBeInstanceOf(Buffer);
    expect(result.result?.time).toBeInstanceOf(Date);
    expect(result.result?.signature).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------

describe("RODB alerts", () => {
  test("getAlert returns the open alert by its dedup key", async () => {
    const result = await rodb.getAlert(openKey);
    expect(result.success).toBe(true);
    expect(result.result).not.toBeNull();
    expect(result.result?.alertId).toBe(openKey);
    expect(result.result?.chainId).toBe(chainId);
    expect(result.result?.alertType).toBe("missed_blocks");
    expect(result.result?.closedAt).toBeUndefined();
  });

  test("getAlert returns the closed alert including its closedAt", async () => {
    const result = await rodb.getAlert(closedKey);
    expect(result.success).toBe(true);
    expect(result.result?.alertType).toBe("node_down");
    expect(result.result?.closedAt).toBeInstanceOf(Date);
    expect(result.result?.closedAt?.toISOString()).toBe("2026-05-01T09:00:00.000Z");
  });

  test("getAlert returns null for a key that does not exist", async () => {
    const result = await rodb.getAlert("this_key_does_not_exist");
    expect(result.success).toBe(true);
    expect(result.result).toBeNull();
  });

  test("getUnclosedAlerts returns only the open alert", async () => {
    const result = await rodb.getUnclosedAlerts();
    expect(result.success).toBe(true);
    expect(result.result).toHaveLength(1);
    expect(result.result?.[0].alertId).toBe(openKey);
  });

  test("getUnclosedAlerts excludes the closed alert", async () => {
    const result = await rodb.getUnclosedAlerts();
    const ids = result.result?.map((a) => a.alertId) ?? [];
    expect(ids).not.toContain(closedKey);
  });

  test("getUnclosedAlerts result has openedAt as a Date", async () => {
    const result = await rodb.getUnclosedAlerts();
    expect(result.result?.[0].openedAt).toBeInstanceOf(Date);
    expect(result.result?.[0].openedAt.toISOString()).toBe("2026-05-01T10:00:00.000Z");
  });
});
