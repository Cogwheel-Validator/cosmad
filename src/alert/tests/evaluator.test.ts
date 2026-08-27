import { describe, expect, test } from "vitest";
import { BlockWindowStats } from "@/pkgs/database/analytics";
import { Block } from "@/pkgs/database/tables";
import { AlertEvaluator } from "..";

const CHAIN_ID = "test-chain";

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

    const events = evaluator.evaluate(tailBlocks, 3, windowStats, [], true, true);
    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe("open");
    expect(events[0]?.alert.alertType).toBe("percentage_miss");
  });

  test("does not breach when the missed ratio is under threshold", () => {
    const evaluator = new AlertEvaluator(CHAIN_ID, baseConfig());
    const windowStats = new BlockWindowStats(100, 5); // 5% missed, < 10% threshold

    const events = evaluator.evaluate([block(1, 1)], 3, windowStats, [], true, true);
    expect(events).toHaveLength(0);
  });

  test("total = 0 (no eligible blocks) never breaches", () => {
    const evaluator = new AlertEvaluator(CHAIN_ID, baseConfig());
    const windowStats = new BlockWindowStats(0, 0);

    const events = evaluator.evaluate([block(1, 1)], 3, windowStats, [], true, true);
    expect(events).toHaveLength(0);
  });
});

describe("AlertEvaluator.checkStalled via evaluate()", () => {
  test("does not fire while still catching up (caughtUp = false), even with a stale tail block", () => {
    const cfg = {
      ...baseConfig(),
      percentageMissedBlocksAlert: { enabled: false, threshold: 10, repeat: false },
      stalledAlert: { enabled: true, stalledThreshold: 60 },
    };
    const evaluator = new AlertEvaluator(CHAIN_ID, cfg);
    const staleBlock = block(1, 1, new Date(Date.now() - 3_600_000)); // 1h old
    const windowStats = new BlockWindowStats(0, 0);

    const events = evaluator.evaluate([staleBlock], 3, windowStats, [], true, false);
    expect(events).toHaveLength(0);
  });

  test("fires once caught up with a stale tail block", () => {
    const cfg = {
      ...baseConfig(),
      percentageMissedBlocksAlert: { enabled: false, threshold: 10, repeat: false },
      stalledAlert: { enabled: true, stalledThreshold: 60 },
    };
    const evaluator = new AlertEvaluator(CHAIN_ID, cfg);
    const staleBlock = block(1, 1, new Date(Date.now() - 3_600_000));
    const windowStats = new BlockWindowStats(0, 0);

    const events = evaluator.evaluate([staleBlock], 3, windowStats, [], true, true);
    expect(events).toHaveLength(1);
    expect(events[0]?.alert.alertType).toBe("stalled");
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

    const events = evaluator.evaluate(tailBlocks, 3, windowStats, [], true, true);
    expect(events).toHaveLength(1);
    expect(events[0]?.alert.alertType).toBe("consecutive_miss");
  });
});
