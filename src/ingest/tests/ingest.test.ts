import { describe, expect, test, vi } from "vitest";
import type { IWriteDb } from "@/pkgs/database/interfaces";
import { Alert } from "@/pkgs/database/tables";
import type { Result } from "@/pkgs/models/result";
import { IngestLayer } from "..";

const CHAIN_ID = "test-chain";

function fakeDb(overrides: Partial<IWriteDb> = {}): IWriteDb {
  return {
    appendBlocks: vi.fn(),
    insertBlocks: vi.fn(),
    latestBlock: vi.fn(),
    latestBlockHeight: vi.fn(),
    insertAlert: vi.fn(async () => ({ ok: true, value: undefined }) as Result<void, Error>),
    getAlert: vi.fn(),
    getUnclosedAlerts: vi.fn(),
    closeAlert: vi.fn(),
    touchAlertNotified: vi.fn(),
    getBlockByHeight: vi.fn(),
    getBlockByRange: vi.fn(),
    getBlockStats: vi.fn(),
    getChainSignedPercentage: vi.fn(),
    getDailySignedStats: vi.fn(),
    close: vi.fn(),
    ...overrides,
  } as IWriteDb;
}

function makeAlert(): Alert {
  return new Alert({
    alertId: Alert.generateId(),
    chainId: CHAIN_ID,
    alertType: "stalled",
    openedAt: new Date(),
  });
}

describe("IngestLayer.ingestAlert", () => {
  test("inserts a brand new incident", async () => {
    const db = fakeDb({
      getAlert: vi.fn(async () => ({ ok: true, value: null }) as const),
    });
    const ingest = new IngestLayer(db, CHAIN_ID);

    const result = await ingest.ingestAlert(makeAlert());

    expect(result.ok).toBe(true);
    expect(db.insertAlert).toHaveBeenCalledTimes(1);
  });

  test("skips insert when a row with this exact alertId already exists (idempotency, not (chainId, alertType) dedup)", async () => {
    // Since alertId is now unique-per-incident (Alert.generateId), this path only matters for
    // re-processing the very same in-flight incident twice - the (chainId, alertType) "is one
    // already open" decision is made upstream by AlertEvaluator, not here.
    const incident = makeAlert();
    const db = fakeDb({
      getAlert: vi.fn(async () => ({ ok: true, value: incident }) as const),
    });
    const ingest = new IngestLayer(db, CHAIN_ID);

    const result = await ingest.ingestAlert(incident);

    expect(result.ok).toBe(true);
    expect(db.insertAlert).not.toHaveBeenCalled();
  });

  test("a second incident of the same alert type gets a distinct alertId and is inserted as a new row", async () => {
    const db = fakeDb({
      getAlert: vi.fn(async () => ({ ok: true, value: null }) as const),
    });
    const ingest = new IngestLayer(db, CHAIN_ID);

    const first = makeAlert();
    const second = makeAlert();
    expect(first.alertId).not.toBe(second.alertId);

    await ingest.ingestAlert(first);
    await ingest.ingestAlert(second);

    expect(db.insertAlert).toHaveBeenCalledTimes(2);
  });
});
