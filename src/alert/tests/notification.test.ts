import { describe, expect, test } from "vitest";
import { Alert } from "@/pkgs/database/tables";
import { buildNotification } from "../notifiers";
import type { AlertContext, AlertEvent } from "../types";

const CHAIN_ID = "celestia";

function alert(alertType: string): Alert {
  return new Alert({
    alertId: "test-alert-id",
    chainId: CHAIN_ID,
    alertType,
    openedAt: new Date(),
  });
}

describe("buildNotification", () => {
  test("percentage_miss open includes the miss ratio, window size and latest block", () => {
    const context: AlertContext = {
      latestBlockHeight: "1234567",
      latestBlockTime: new Date("2026-08-28T10:00:00.000Z"),
      windowTotal: 340,
      windowMissed: 42,
      windowMissedPercent: 12.35,
      threshold: 10,
    };
    const event: AlertEvent = { kind: "open", alert: alert("percentage_miss"), context };

    const notification = buildNotification(event, CHAIN_ID);

    expect(notification.message).toBe(
      "[celestia] Alert opened: percentage_miss (12.35% missed over the last 340 blocks " +
        "(42/340, threshold 10%); latest known block 1234567 at 2026-08-28T10:00:00.000Z)",
    );
    expect(notification.context).toBe(context);
  });

  test("consecutive_miss repeat includes the streak length and threshold", () => {
    const context: AlertContext = { consecutiveMissed: 7, threshold: 5 };
    const existing = alert("consecutive_miss");
    const event: AlertEvent = { kind: "repeat", alert: existing, context };

    const notification = buildNotification(event, CHAIN_ID);

    expect(notification.message).toBe(
      "[celestia] Alert still open (repeat #1): consecutive_miss (7 consecutive misses (threshold 5))",
    );
  });

  test("stalled close includes the threshold and recovers with no extra block info when absent", () => {
    const context: AlertContext = { threshold: 60 };
    const event: AlertEvent = {
      kind: "close",
      alert: alert("stalled"),
      closedAt: new Date(),
      context,
    };

    const notification = buildNotification(event, CHAIN_ID);

    expect(notification.message).toBe(
      "[celestia] Alert closed: stalled (no new block seen in over 60s)",
    );
  });

  test("falls back to the bare message when no context fields apply", () => {
    const event: AlertEvent = { kind: "open", alert: alert("inactive"), context: {} };

    const notification = buildNotification(event, CHAIN_ID);

    expect(notification.message).toBe("[celestia] Alert opened: inactive");
  });
});
