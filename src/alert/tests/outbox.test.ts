import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { RWDB } from "@/pkgs/database/duckdb/rw_db";
import type { IWriteDb } from "@/pkgs/database/interfaces";
import { Alert } from "@/pkgs/database/tables";
import type { Result } from "@/pkgs/models/result";
import { NotificationDispatcher, retryPause } from "../notifiers";
import type { AlertNotification, Notifier } from "../notifiers/types";
import type { AlertEvent } from "../types";

const CHAIN_ID = "outbox-chain";

class FakeNotifier implements Notifier {
  sent: AlertNotification[] = [];
  failing = true;
  async send(n: AlertNotification): Promise<Result<void, Error>> {
    if (this.failing) return { ok: false, error: new Error("down") };
    this.sent.push(n);
    return { ok: true, value: undefined };
  }
}

function openEvent(alertId: string): AlertEvent {
  const alert = new Alert({
    alertId,
    chainId: CHAIN_ID,
    alertType: "stalled",
    openedAt: new Date(),
  });
  return { kind: "open", alert, context: {} };
}

describe("retryPause", () => {
  test("doubles per failed round up to the cap", () => {
    const pauses = [1, 2, 3, 4, 5, 6].map((n) => retryPause(n, 5, 30));
    expect(pauses).toEqual([5, 10, 20, 30, 30, 30]);
  });
});

describe("notification outbox", () => {
  const dir = join(tmpdir(), `cosmad_test_outbox_${Date.now()}`);
  let rwdb: RWDB;
  let db: IWriteDb;
  let tg: FakeNotifier;
  let dc: FakeNotifier;
  let dispatcher: NotificationDispatcher;

  const make = (retryPauseMs = 1_000) =>
    new NotificationDispatcher({} as never, {} as never, db, {
      notifiers: [
        { name: "telegram", notifier: tg },
        { name: "discord", notifier: dc },
      ],
      sendRetryDelayMs: 0,
      retryPauseMs,
      maxRetryPauseMs: 4_000,
    });

  beforeAll(async () => {
    rwdb = await RWDB.create(dir, { threads: "1", memory_limit: "512MB" });
    db = rwdb.forChain(CHAIN_ID, "bft");
  });
  afterAll(() => {
    rwdb.close();
    rmSync(dir, { recursive: true, force: true });
  });
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await rwdb.conn.run("DELETE FROM notification_outbox");
    tg = new FakeNotifier();
    dc = new FakeNotifier();
    dispatcher = make();
  });

  async function pending() {
    const r = await db.getPendingNotifications(100);
    if (!r.ok) throw r.error;
    return r.value;
  }

  test("a failed round is retried after a doubling pause until it goes through, per notifier", async () => {
    dc.failing = false; // only telegram is down
    await dispatcher.enqueue(openEvent("a1"), CHAIN_ID);
    await dispatcher.deliverPending();

    expect(dc.sent).toHaveLength(1);
    let rows = await pending();
    expect(rows.map((r) => [r.notifier, r.failedRounds])).toEqual([["telegram", 1]]);

    // Still inside the 1s pause: nothing is retried.
    await dispatcher.deliverPending();
    expect((await pending())[0]?.failedRounds).toBe(1);

    vi.advanceTimersByTime(1_001);
    await dispatcher.deliverPending();
    rows = await pending();
    expect(rows[0]?.failedRounds).toBe(2);
    expect(rows[0]?.nextAttemptAt.getTime()).toBeGreaterThanOrEqual(Date.now() + 1_999);

    tg.failing = false;
    vi.advanceTimersByTime(2_001);
    await dispatcher.deliverPending();
    expect(tg.sent).toHaveLength(1);
    expect(dc.sent).toHaveLength(1); // not re-sent to the channel that already got it
    expect(await pending()).toHaveLength(0);
  });

  test("survives a restart: a new dispatcher picks the pending notification up", async () => {
    await dispatcher.enqueue(openEvent("a2"), CHAIN_ID);
    await dispatcher.deliverPending();
    expect(await pending()).toHaveLength(2);

    tg.failing = false;
    dc.failing = false;
    const restarted = make();
    vi.advanceTimersByTime(1_001);
    await restarted.deliverPending();

    expect(tg.sent).toHaveLength(1);
    expect(dc.sent).toHaveLength(1);
    expect(await pending()).toHaveLength(0);
  });

  test("a stale opened notification is dropped once the alert closed, and closed still goes out in order", async () => {
    const event = openEvent("a3");
    await db.insertAlert(event.alert);
    await dispatcher.enqueue(event, CHAIN_ID);
    await dispatcher.deliverPending();

    await db.closeAlert("a3", new Date());
    await dispatcher.enqueue(
      { kind: "close", alert: event.alert, closedAt: new Date(), context: {} },
      CHAIN_ID,
    );
    tg.failing = false;
    dc.failing = false;
    await dispatcher.deliverPending();

    expect(tg.sent.map((n) => n.kind)).toEqual(["closed"]);
    expect(dc.sent.map((n) => n.kind)).toEqual(["closed"]);
    expect(await pending()).toHaveLength(0);
  });

  test("a notifier that is no longer configured is dropped, not retried forever", async () => {
    await dispatcher.enqueue(openEvent("a4"), CHAIN_ID);
    const onlyDiscord = new NotificationDispatcher({} as never, {} as never, db, {
      notifiers: [{ name: "discord", notifier: dc }],
      sendRetryDelayMs: 0,
    });
    dc.failing = false;
    await onlyDiscord.deliverPending();
    expect(dc.sent).toHaveLength(1);
    expect(await pending()).toHaveLength(0);
  });
});
