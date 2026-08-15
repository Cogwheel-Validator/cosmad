import type { AlertConfig } from "@/config/alert_types";
import { Alert, type Block } from "@/pkgs/database/tables";
import type { AlertEvent } from "./types";

type AlertConfigType = typeof AlertConfig.infer;

export class AlertEvaluator {
  constructor(
    private chainId: string,
    private cfg: AlertConfigType,
  ) {}

  public evaluate(
    recentBlocks: Block[],
    consecutiveMissThreshold: number,
    openAlerts: Alert[],
    validatorActive: boolean,
  ): AlertEvent[] {
    const openById = new Map(openAlerts.map((a) => [a.alertId, a]));
    return [
      ...this.checkStalled(recentBlocks[0], openById),
      ...this.checkConsecutiveMiss(recentBlocks.slice(consecutiveMissThreshold), openById),
      ...this.checkPercentageMiss(recentBlocks, openById),
      ...this.checkInactive(validatorActive, openById),
    ];
  }

  /**
   *
   * @param recentBlocks
   * @param openById
   * @returns
   */
  private checkStalled(latestBlock: Block, openById: Map<string, Alert>): AlertEvent[] {
    const { stalledAlert } = this.cfg;
    if (!stalledAlert.enabled) return [];

    const alertId = Alert.generateKey(this.chainId, "stalled");
    const existing = openById.get(alertId);
    const isStalled =
      latestBlock == null ||
      Date.now() - latestBlock.time.getTime() > stalledAlert.stalledThreshold * 1000;

    if (isStalled && existing == null) {
      return [
        {
          kind: "open",
          alert: new Alert({
            alertId,
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
   * @param openById map of open alerts by id
   * @returns AlertEvent[]
   */
  private checkConsecutiveMiss(recentBlocks: Block[], openById: Map<string, Alert>): AlertEvent[] {
    const { consecutiveMissAlert } = this.cfg;
    if (!consecutiveMissAlert.enabled) return [];

    const alertId = Alert.generateKey(this.chainId, "consecutive_miss");
    const existing = openById.get(alertId);
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
            alertId,
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
   * @param recentBlocks insert amount set by the slashing event, if lower that this amount insert all blocks
   * @param openById a map of open alerts by their ID
   * @returns AlertEvent[]
   */
  private checkPercentageMiss(recentBlocks: Block[], openById: Map<string, Alert>): AlertEvent[] {
    const { percentageMissedBlocksAlert } = this.cfg;
    if (!percentageMissedBlocksAlert.enabled || recentBlocks.length === 0) return [];

    const alertId = Alert.generateKey(this.chainId, "percentage_miss");
    const existing = openById.get(alertId);
    const missed = recentBlocks.filter((b) => !b.signed).length;
    const ratio = (missed / recentBlocks.length) * 100;
    const breached = ratio >= percentageMissedBlocksAlert.threshold;

    if (breached && existing == null) {
      return [
        {
          kind: "open",
          alert: new Alert({
            alertId,
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

  private checkInactive(validatorActive: boolean, openById: Map<string, Alert>): AlertEvent[] {
    if (!this.cfg.alertIfInactive) return [];

    const alertId = Alert.generateKey(this.chainId, "inactive");
    const existing = openById.get(alertId);
    if (!validatorActive && existing == null) {
      return [
        {
          kind: "open",
          alert: new Alert({
            alertId,
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
