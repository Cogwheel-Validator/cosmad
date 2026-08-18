import assert from "node:assert";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { RWDB } from "@/pkgs/database/duckdb/rw_db";
import { Alert, Block } from "@/pkgs/database/tables";
import { EngineConnection } from "../client";
import { startEngineServer } from "../server";

const testDir = join(tmpdir(), `cosmad_test_engine_${Date.now()}`);
const socketPath = join(tmpdir(), `cosmad_test_engine_${Date.now()}.sock`);
const chainId = "test-chain";

let stopServer: () => void;
let rwdb: RWDB;
let writer: EngineConnection;
let reader: EngineConnection;

beforeAll(async () => {
  const options = { threads: "2", memoryLimit: "500MB", maxTempDirectorySize: "1GB" };
  rwdb = await RWDB.create(testDir, options);
  stopServer = await startEngineServer(
    rwdb,
    new Map([
      [chainId, "bft"],
      ["chain-a", "bft"],
      ["chain-b", "bft"],
      ["chain-c", "bft"],
    ]),
    socketPath,
  );
  writer = await EngineConnection.connect(socketPath, "writer");
  reader = await EngineConnection.connect(socketPath, "reader");
});

afterAll(() => {
  writer.close();
  reader.close();
  stopServer();
  rwdb.close();
  rmSync(testDir, { recursive: true, force: true });
});

describe("engine over Unix socket", () => {
  test("writer connection can insert and read back a block", async () => {
    const db = writer.forChain(chainId, "bft");
    const signature = "dGVzdAo="; // equal to test
    const signBytes = Buffer.from(signature, "base64");
    const result = await db.appendBlocks([
      new Block({
        chainId,
        height: 1n,
        hash: "0102030405060708090a0b0c0d0e0f10",
        time: new Date("2026-01-01T00:00:00.000Z"),
        signed: 1,
        signature: signature,
        chainType: "bft",
      }),
    ]);
    expect(result.ok).toBe(true);

    const latest = await db.latestBlock();
    assert(latest.ok);
    expect(latest.value?.height).toBe(1n);
    expect(latest.value?.hash.toString("hex")).toBe("0102030405060708090a0b0c0d0e0f10");
    expect(latest.value?.time.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(latest.value?.signed).toBe(1);
    expect(latest.value?.signature).toStrictEqual(signBytes);
  });

  test("a separate reader connection sees the same data", async () => {
    const db = reader.forChain(chainId, "bft");
    const latest = await db.latestBlock();
    assert(latest.ok);
    expect(latest.value?.height).toBe(1n);
  });

  test("reader connection write attempts are rejected server-side, not just by the client's TS type", async () => {
    const db = reader.forChain(chainId, "bft");
    const result = await db.insertAlert(
      new Alert({ alertId: "x", chainId, alertType: "test", openedAt: new Date() }),
    );
    expect(result.ok).toBe(false);
    assert(!result.ok);
    expect(result.error.message).toMatch(/read-only/i);
  });

  test("reader connection appendBlocks is also rejected", async () => {
    const db = reader.forChain(chainId, "bft");
    const signature = "dGVzdAo=";
    const signBytes = Buffer.from(signature, "base64");
    const result = await db.appendBlocks([
      new Block({
        chainId,
        height: 2n,
        hash: "1112131415161718191a1b1c1d1e1f20",
        time: new Date(),
        signed: 1,
        signature: signBytes,
        chainType: "bft",
      }),
    ]);
    expect(result.ok).toBe(false);
    assert(!result.ok);
    expect(result.error.message).toMatch(/read-only/i);

    // Confirm it really didn't get written.
    const latest = await writer.forChain(chainId, "bft").latestBlock();
    assert(latest.ok);
    expect(latest.value?.height).toBe(1n);
  });

  test("requests for an unconfigured chain id return an error, not a crash", async () => {
    const db = writer.forChain("does-not-exist", "bft");
    const result = await db.latestBlock();
    expect(result.ok).toBe(false);
    assert(!result.ok);
    expect(result.error.message).toMatch(/Unknown chain/);
  });

  test("full alert lifecycle over the socket: insert, get, touch, close", async () => {
    const db = writer.forChain(chainId, "bft");
    const alertId = Alert.generateId();
    const openedAt = new Date("2026-02-01T00:00:00.000Z");

    const insertResult = await db.insertAlert(
      new Alert({ alertId, chainId, alertType: "stalled", openedAt }),
    );
    expect(insertResult.ok).toBe(true);

    const unclosed = await db.getUnclosedAlerts();
    assert(unclosed.ok);
    expect(unclosed.value.map((a) => a.alertId)).toContain(alertId);

    const touchResult = await db.touchAlertNotified(
      alertId,
      new Date("2026-02-01T01:00:00.000Z"),
      1,
    );
    expect(touchResult.ok).toBe(true);

    const afterTouch = await db.getAlert(alertId);
    assert(afterTouch.ok);
    expect(afterTouch.value?.repeatCount).toBe(1);
    expect(afterTouch.value?.lastNotifiedAt?.toISOString()).toBe("2026-02-01T01:00:00.000Z");

    const closeResult = await db.closeAlert(alertId, new Date("2026-02-01T02:00:00.000Z"));
    expect(closeResult.ok).toBe(true);

    const afterClose = await db.getAlert(alertId);
    assert(afterClose.ok);
    expect(afterClose.value?.closedAt?.toISOString()).toBe("2026-02-01T02:00:00.000Z");
  });

  test.concurrent("insert chain-a 100 blocks", async () => {
    const db = writer.forChain("chain-a", "bft");
    const signature = "dGVzdAo=";
    const hash = "1112131415161718191a1b1c1d1e1f20";
    const blocks = Array.from(
      { length: 100 },
      (_, i) =>
        new Block({
          chainId: "chain-a",
          height: BigInt(i),
          time: new Date(),
          signed: 1,
          signature: signature,
          chainType: "bft",
          hash: hash,
        }),
    );
    const result = await db.insertBlocks(blocks);
    assert(result.ok);

    // fetch random block range of 10 blocks to see if it was recorded and that it wasn't halted by concurrent process
    const start = Math.floor(Math.random() * 90);
    const r = await db.getBlockByRange(BigInt(start), BigInt(start + 10));
    assert(r.ok);
    expect(r.value).toHaveLength(11);
    expect(r.value.map((b) => b.height)).toEqual(
      Array.from({ length: 11 }, (_, i) => BigInt(start + i)),
    );
  });

  // purpose of this test is to insert 100 blocks concurrently and verify they are recorded correctly
  test.concurrent("insert chain-b 100 blocks", async () => {
    const db = writer.forChain("chain-b", "bft");
    const signature = "dGVzdAo=";
    const hash = "1112131415161718191a1b1c1d1e1f20";
    const blocks = Array.from(
      { length: 100 },
      (_, i) =>
        new Block({
          chainId: "chain-b",
          height: BigInt(i),
          time: new Date(),
          signed: 1,
          signature: signature,
          chainType: "bft",
          hash: hash,
        }),
    );
    const result = await db.insertBlocks(blocks);
    assert(result.ok);
  });

  test("getBlockStats aggregates over the wire, excluding signed=-1 blocks entirely", async () => {
    const db = writer.forChain("chain-c", "bft");
    const hash = "1112131415161718191a1b1c1d1e1f20";
    // signed: 1,1,0,0,0,-1,-1 — total should exclude the two -1s (5), missed should count
    // only the three 0s.
    const signedValues = [1, 1, 0, 0, 0, -1, -1];
    const blocks = signedValues.map(
      (signed, i) =>
        new Block({
          chainId: "chain-c",
          height: BigInt(i),
          time: new Date(),
          signed,
          signature: undefined,
          chainType: "bft",
          hash,
        }),
    );
    const result = await db.insertBlocks(blocks);
    assert(result.ok);

    const stats = await db.getBlockStats(0n, 6n);
    assert(stats.ok);
    expect(stats.value.total).toBe(5);
    expect(stats.value.missed).toBe(3);
  });
});
