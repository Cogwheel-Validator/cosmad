import { describe, expect, test } from "vitest";
import { BlockWindowStats } from "@/pkgs/database/analytics";
import { Alert, Block } from "@/pkgs/database/tables";
import { AlertEvaluator } from "..";
import type { ValidatorStatus } from "../types";

const CHAIN_ID = "test-chain";

// A chain tip that was just produced - never stalled.
const freshTip = { height: 1n, time: new Date() };

function block(height: number, signed: number, time = new Date()): Block {
  return new Block({
    chainId: CHAIN_ID,
    height: BigInt(height),
    hash: "AA",
    time,
    signed,
    signature: undefined,
    chainType: "bft",
  });
}

function baseConfig() {
  return {
    alertIfInactive: false,
    stalledAlert: { enabled: false, stalledThreshold: 999_999 },
    consecutiveMissAlert: { enabled: false, threshold: 3, repeat: false, repeatInterval: 0 },
    percentageMissedBlocksAlert: { enabled: true, threshold: 10, repeat: false },
  };
}

describe("AlertEvaluator.checkPercentageMiss via evaluate()", () => {
  test("breaches using pre-aggregated windowStats, not the tailBlocks array", () => {
    const evaluator = new AlertEvaluator(CHAIN_ID, baseConfig());
    const tailBlocks = [block(1, 1)];
    const windowStats = new BlockWindowStats(100, 20); // 20% missed, >= 10% threshold

    const events = evaluator.evaluate(tailBlocks, 3, windowStats, [], undefined, freshTip);
    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe("open");
    expect(events[0]?.alert.alertType).toBe("percentage_miss");
    expect(events[0]?.context).toEqual({
      latestBlockHeight: "1",
      latestBlockTime: tailBlocks[0]?.time,
      windowTotal: 100,
      windowMissed: 20,
      windowMissedPercent: 20,
      threshold: 10,
    });
  });

  test("does not breach when the missed ratio is under threshold", () => {
    const evaluator = new AlertEvaluator(CHAIN_ID, baseConfig());
    const windowStats = new BlockWindowStats(100, 5); // 5% missed, < 10% threshold

    const events = evaluator.evaluate([block(1, 1)], 3, windowStats, [], undefined, freshTip);
    expect(events).toHaveLength(0);
  });

  test("total = 0 (no eligible blocks) never breaches", () => {
    const evaluator = new AlertEvaluator(CHAIN_ID, baseConfig());
    const windowStats = new BlockWindowStats(0, 0);

    const events = evaluator.evaluate([block(1, 1)], 3, windowStats, [], undefined, freshTip);
    expect(events).toHaveLength(0);
  });
});

describe("AlertEvaluator.checkStalled via evaluate()", () => {
  const cfg = () => ({
    ...baseConfig(),
    percentageMissedBlocksAlert: { enabled: false, threshold: 10, repeat: false },
    stalledAlert: { enabled: true, stalledThreshold: 60 },
  });

  test("does not fire while the chain tip is recent, even with a stale stored block (backfill)", () => {
    const evaluator = new AlertEvaluator(CHAIN_ID, cfg());
    const staleBlock = block(1, 1, new Date(Date.now() - 3_600_000)); // 1h old
    const windowStats = new BlockWindowStats(0, 0);

    const events = evaluator.evaluate([staleBlock], 3, windowStats, [], undefined, freshTip);
    expect(events).toHaveLength(0);
  });

  test("does not fire with no stored blocks at all (fresh start) while the tip is recent", () => {
    const evaluator = new AlertEvaluator(CHAIN_ID, cfg());
    const events = evaluator.evaluate([], 3, new BlockWindowStats(0, 0), [], undefined, freshTip);
    expect(events).toHaveLength(0);
  });

  test("fires once the chain tip is older than the threshold", () => {
    const evaluator = new AlertEvaluator(CHAIN_ID, cfg());
    const staleTip = { height: 1n, time: new Date(Date.now() - 3_600_000) };
    const windowStats = new BlockWindowStats(0, 0);

    const events = evaluator.evaluate([block(1, 1)], 3, windowStats, [], undefined, staleTip);
    expect(events).toHaveLength(1);
    expect(events[0]?.alert.alertType).toBe("stalled");
    expect(events[0]?.context.latestBlockHeight).toBe("1");
  });
});

describe("AlertEvaluator.checkConsecutiveMiss via evaluate()", () => {
  test("uses only the trailing consecutiveMissThreshold blocks from tailBlocks (ascending order)", () => {
    const cfg = {
      ...baseConfig(),
      percentageMissedBlocksAlert: { enabled: false, threshold: 10, repeat: false },
      consecutiveMissAlert: { enabled: true, threshold: 3, repeat: false, repeatInterval: 0 },
    };
    const evaluator = new AlertEvaluator(CHAIN_ID, cfg);
    // Oldest first, most recent last - last 3 are all missed.
    const tailBlocks = [block(1, 1), block(2, 1), block(3, 0), block(4, 0), block(5, 0)];
    const windowStats = new BlockWindowStats(0, 0);

    const events = evaluator.evaluate(tailBlocks, 3, windowStats, [], undefined, freshTip);
    expect(events).toHaveLength(1);
    expect(events[0]?.alert.alertType).toBe("consecutive_miss");
  });
});

describe("AlertEvaluator validator status alerts", () => {
  const cfg = () => ({
    ...baseConfig(),
    alertIfInactive: true,
    percentageMissedBlocksAlert: { enabled: false, threshold: 10, repeat: false },
  });
  const status = (over: Partial<ValidatorStatus>): ValidatorStatus => ({
    height: 10n,
    time: new Date(),
    active: false,
    jailed: false,
    permanent: false,
    bondStatus: "BOND_STATUS_UNBONDED",
    ...over,
  });
  const open = (alertType: string) =>
    new Alert({ alertId: Alert.generateId(), chainId: CHAIN_ID, alertType, openedAt: new Date() });
  const run = (s: ValidatorStatus | undefined, openAlerts: Alert[] = []) =>
    new AlertEvaluator(CHAIN_ID, cfg())
      .evaluate([], 3, new BlockWindowStats(0, 0), openAlerts, s, freshTip)
      .map((e) => `${e.kind}:${e.alert.alertType}`);

  test("out of the active set without a jail -> inactive", () => {
    expect(run(status({}))).toEqual(["open:inactive"]);
  });

  test("jailed -> jailed, tombstoned -> tombstoned", () => {
    expect(run(status({ jailed: true }))).toEqual(["open:jailed"]);
    expect(run(status({ jailed: true, permanent: true }))).toEqual(["open:tombstoned"]);
  });

  test("a change of reason closes the old alert and opens the new one", () => {
    expect(run(status({ jailed: true, permanent: true }), [open("jailed")])).toEqual([
      "close:jailed",
      "open:tombstoned",
    ]);
  });

  test("back in the active set closes whichever status alert is open", () => {
    expect(
      run(status({ active: true, bondStatus: "BOND_STATUS_BONDED" }), [open("jailed")]),
    ).toEqual(["close:jailed"]);
  });

  test("an unknown status (REST down) leaves an open alert alone", () => {
    expect(run(undefined, [open("jailed")])).toEqual([]);
  });
});

describe("AlertEvaluator.evaluateEndpoints", () => {
  const evaluator = () => new AlertEvaluator(CHAIN_ID, baseConfig());
  const rpc = (url: string, healthy: boolean | undefined, alertIfDown = true) => ({
    kind: "rpc" as const,
    url,
    alertIfDown,
    healthy,
    reason: "unreachable",
  });
  const openDown = (url: string) =>
    new Alert({
      alertId: Alert.generateId(),
      chainId: CHAIN_ID,
      alertType: "rpc_down",
      subject: url,
      openedAt: new Date(),
    });

  test("one alert per down endpoint with alertIfDown, carrying the URL as subject", () => {
    const events = evaluator().evaluateEndpoints(
      [rpc("http://a", false), rpc("http://b", false), rpc("http://c", false, false)],
      [],
    );
    expect(events.map((e) => `${e.kind}:${e.alert.alertType}:${e.alert.subject}`)).toEqual([
      "open:rpc_down:http://a",
      "open:rpc_down:http://b",
    ]);
  });

  test("closes when healthy again or removed from config, ignores not-yet-checked endpoints", () => {
    const events = evaluator().evaluateEndpoints(
      [rpc("http://a", true), rpc("http://b", undefined)],
      [openDown("http://a"), openDown("http://b"), openDown("http://gone")],
    );
    expect(events.map((e) => `${e.kind}:${e.alert.subject}`)).toEqual([
      "close:http://a",
      "close:http://gone",
    ]);
  });
});
