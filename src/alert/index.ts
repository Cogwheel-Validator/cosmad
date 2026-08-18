import type { AlertConfig } from "@/config/alert_types";
import type { BlockWindowStats } from "@/pkgs/database/analytics";
import { Alert, type Block } from "@/pkgs/database/tables";
import type { AlertEvent } from "./types";

type AlertConfigType = typeof AlertConfig.infer;

export class AlertEvaluator {
  constructor(
    private chainId: string,
    private cfg: AlertConfigType,
  ) {}

  /** evaluate is a function that sets in motion 4 checks.
   *
   * 1. Stalled alert: checks if the chain has been inactive for the specified amount of time.
   * 2. Consecutive miss alert: checks if the chain has missed a block in a row for the specified
   *    number of blocks.
   * 3. Percentage missed blocks alert: checks if the percentage of missed blocks over the full
   *    signing window exceeds the specified threshold.
   * 4. Check inactive: checks if the validator is inactive.
   * @param tailBlocks a small trailing window (ascending height order, oldest first).
   * @param windowStats aggregate {total, missed} counts over the full signing window.
   * @param openAlerts a list of currently open alerts for this chain.
   * @param validatorActive whether the validator is currently active.
   * @param caughtUp if the cosmad has caught up to the chain's current tip.
   * @returns a list of alert events to apply to the open alert state.
   */
  public evaluate(
    tailBlocks: Block[],
    consecutiveMissThreshold: number,
    windowStats: BlockWindowStats,
    openAlerts: Alert[],
    validatorActive: boolean,
    caughtUp: boolean,
  ): AlertEvent[] {
    const openByType = new Map(openAlerts.map((a) => [a.alertType, a]));
    return [
      ...(caughtUp ? this.checkStalled(tailBlocks[tailBlocks.length - 1], openByType) : []),
      ...this.checkConsecutiveMiss(tailBlocks.slice(-consecutiveMissThreshold), openByType),
      ...this.checkPercentageMiss(windowStats, openByType),
      ...this.checkInactive(validatorActive, openByType),
    ];
  }

  /**
   * Checks if the chain has been stalled (inactive for too long). Could be caused by
   * node stopped working, or the chain has halted due to some unexpected condition.
   * @param recentBlocks the most recent blocks, used to determine if the chain is stalled.
   * @param openByType a map of currently open alerts for this chain, by alertType.
   * @returns an array of alert events, including any open or closed stalled alerts.
   */
  private checkStalled(latestBlock: Block, openByType: Map<string, Alert>): AlertEvent[] {
    const { stalledAlert } = this.cfg;
    if (!stalledAlert.enabled) return [];

    const existing = openByType.get("stalled");
    const isStalled =
      latestBlock == null ||
      Date.now() - latestBlock.time.getTime() > stalledAlert.stalledThreshold * 1000;

    if (isStalled && existing == null) {
      return [
        {
          kind: "open",
          alert: new Alert({
            alertId: Alert.generateId(),
            chainId: this.chainId,
            alertType: "stalled",
            openedAt: new Date(),
          }),
        },
      ];
    }
    if (!isStalled && existing != null) {
      return [{ kind: "close", alert: existing, closedAt: new Date() }];
    }
    return [];
  }

  /**
   * checkConsecutiveMiss is responsible for checking for a consecutive missed blocks alert
   * @param recentBlocks the recent blocks to check ( send the amount specified in the config as consecutiveMissAlert.threshold)
   * @param openByType a map of currently open alerts for this chain, by alertType
   * @returns AlertEvent[]
   */
  private checkConsecutiveMiss(
    recentBlocks: Block[],
    openByType: Map<string, Alert>,
  ): AlertEvent[] {
    const { consecutiveMissAlert } = this.cfg;
    if (!consecutiveMissAlert.enabled) return [];

    const existing = openByType.get("consecutive_miss");
    let missed = 0;
    for (let i = recentBlocks.length - 1; i >= 0; i--) {
      if (!recentBlocks[i]?.signed) missed++;
      else break;
    }

    const breached = missed >= consecutiveMissAlert.threshold;
    if (breached && existing == null) {
      return [
        {
          kind: "open",
          alert: new Alert({
            alertId: Alert.generateId(),
            chainId: this.chainId,
            alertType: "consecutive_miss",
            openedAt: new Date(),
          }),
        },
      ];
    }
    if (breached && existing != null) {
      if (!consecutiveMissAlert.repeat) return [];
      const last = existing.lastNotifiedAt ?? existing.openedAt;
      const elapsedSec = (Date.now() - last.getTime()) / 1000;
      if (elapsedSec >= consecutiveMissAlert.repeatInterval) {
        return [{ kind: "repeat", alert: existing }];
      }
      return [];
    }
    if (!breached && existing != null) {
      return [{ kind: "close", alert: existing, closedAt: new Date() }];
    }
    return [];
  }

  /** checkPercentageMiss is responsible for checking for a percentage missed blocks alert
   * @param windowStats aggregate {total, missed} counts over the full signing window
   * @param openByType a map of currently open alerts for this chain, by alertType
   * @returns an array of alert events, including any open or closed percentage missed blocks alerts.
   */
  private checkPercentageMiss(
    windowStats: BlockWindowStats,
    openByType: Map<string, Alert>,
  ): AlertEvent[] {
    const { percentageMissedBlocksAlert } = this.cfg;
    if (!percentageMissedBlocksAlert.enabled || windowStats.total === 0) return [];

    const existing = openByType.get("percentage_miss");
    const ratio = (windowStats.missed / windowStats.total) * 100;
    const breached = ratio >= percentageMissedBlocksAlert.threshold;

    if (breached && existing == null) {
      return [
        {
          kind: "open",
          alert: new Alert({
            alertId: Alert.generateId(),
            chainId: this.chainId,
            alertType: "percentage_miss",
            openedAt: new Date(),
          }),
        },
      ];
    }
    if (breached && existing != null) {
      if (!percentageMissedBlocksAlert.repeat) return [];
      // Each repeat requires the miss ratio to clear the threshold escalated by 50% per prior repeat.
      const nextThreshold =
        percentageMissedBlocksAlert.threshold * 1.5 ** (existing.repeatCount + 1);
      if (ratio >= nextThreshold) {
        return [{ kind: "repeat", alert: existing }];
      }
      return [];
    }
    if (!breached && existing != null) {
      return [{ kind: "close", alert: existing, closedAt: new Date() }];
    }
    return [];
  }

  /**
   * Checks if the validator is inactive (not active and no open alerts).
   * @param validatorActive a bool that marks if validator is active or not
   * @param openByType a map of currently open alerts for this chain, by alertType.
   * @returns an array of alert events, including any open or closed inactive alerts.
   */
  private checkInactive(validatorActive: boolean, openByType: Map<string, Alert>): AlertEvent[] {
    if (!this.cfg.alertIfInactive) return [];

    const existing = openByType.get("inactive");
    if (!validatorActive && existing == null) {
      return [
        {
          kind: "open",
          alert: new Alert({
            alertId: Alert.generateId(),
            chainId: this.chainId,
            alertType: "inactive",
            openedAt: new Date(),
          }),
        },
      ];
    }
    if (validatorActive && existing != null) {
      return [{ kind: "close", alert: existing, closedAt: new Date() }];
    }
    return [];
  }
}
