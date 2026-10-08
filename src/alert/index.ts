import type { AlertConfig } from "@/config/alert_types";
import type { BlockWindowStats } from "@/pkgs/database/analytics";
import { Alert, type Block } from "@/pkgs/database/tables";
import type { AlertContext, AlertEvent, EndpointCheck, ValidatorStatus } from "./types";

/** Alert types describing why the validator is outside the active set - at most one is open. */
const VALIDATOR_STATUS_ALERTS = ["inactive", "jailed", "tombstoned"] as const;
type ValidatorStatusAlert = (typeof VALIDATOR_STATUS_ALERTS)[number];

function blockContext(block: Block | undefined): AlertContext {
  if (block == null) return {};
  return { latestBlockHeight: block.height.toString(), latestBlockTime: block.time };
}

type AlertConfigType = typeof AlertConfig.infer;

/** The chain's newest block as reported by RPC, independent of what cosmad has stored. */
export interface ChainTip {
  height: bigint;
  time: Date;
}

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
   * 4. Validator status: checks if the validator is outside the active set, and why (inactive,
   *    jailed or tombstoned).
   * @param tailBlocks a small trailing window (ascending height order, oldest first).
   * @param windowStats aggregate {total, missed} counts over the full signing window.
   * @param openAlerts a list of currently open alerts for this chain.
   * @param validatorStatus the validator's current status, undefined if it couldn't be
   *    determined (bft only; always undefined for tm2) - status alerts are then left as they are.
   * @param chainTip the chain's newest block as reported by RPC (drives the stalled check).
   * @returns a list of alert events to apply to the open alert state.
   */
  public evaluate(
    tailBlocks: Block[],
    consecutiveMissThreshold: number,
    windowStats: BlockWindowStats,
    openAlerts: Alert[],
    validatorStatus: ValidatorStatus | undefined,
    chainTip: ChainTip,
  ): AlertEvent[] {
    const openByType = new Map(openAlerts.map((a) => [a.alertType, a]));
    const latestBlock = tailBlocks[tailBlocks.length - 1];
    return [
      ...this.checkStalled(chainTip, openByType),
      ...this.checkConsecutiveMiss(tailBlocks.slice(-consecutiveMissThreshold), openByType),
      ...this.checkPercentageMiss(windowStats, latestBlock, openByType),
      ...this.checkValidatorStatus(validatorStatus, openByType),
    ];
  }

  /**
   * Checks if the chain has been stalled (no new block for too long), e.g. a chain halt or the
   * RPC nodes no longer following the chain.
   * Judged from the chain's own tip time, not from cosmad's stored blocks: those lag behind
   * (or don't exist yet on a fresh start, or are old while backfilling after downtime), and
   * neither says anything about whether the chain itself is producing blocks.
   * @param chainTip the chain's newest block as reported by RPC.
   * @param openByType a map of currently open alerts for this chain, by alertType.
   * @returns an array of alert events, including any open or closed stalled alerts.
   */
  private checkStalled(chainTip: ChainTip, openByType: Map<string, Alert>): AlertEvent[] {
    const { stalledAlert } = this.cfg;
    if (!stalledAlert.enabled) return [];

    const existing = openByType.get("stalled");
    const isStalled = Date.now() - chainTip.time.getTime() > stalledAlert.stalledThreshold * 1000;
    const context: AlertContext = {
      latestBlockHeight: chainTip.height.toString(),
      latestBlockTime: chainTip.time,
      threshold: stalledAlert.stalledThreshold,
    };

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
          context,
        },
      ];
    }
    if (!isStalled && existing != null) {
      return [{ kind: "close", alert: existing, closedAt: new Date(), context }];
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
    const context: AlertContext = {
      ...blockContext(recentBlocks[recentBlocks.length - 1]),
      consecutiveMissed: missed,
      threshold: consecutiveMissAlert.threshold,
    };

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
          context,
        },
      ];
    }
    if (breached && existing != null) {
      if (!consecutiveMissAlert.repeat) return [];
      const last = existing.lastNotifiedAt ?? existing.openedAt;
      const elapsedSec = (Date.now() - last.getTime()) / 1000;
      if (elapsedSec >= consecutiveMissAlert.repeatInterval) {
        return [{ kind: "repeat", alert: existing, context }];
      }
      return [];
    }
    if (!breached && existing != null) {
      return [{ kind: "close", alert: existing, closedAt: new Date(), context }];
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
    latestBlock: Block | undefined,
    openByType: Map<string, Alert>,
  ): AlertEvent[] {
    const { percentageMissedBlocksAlert } = this.cfg;
    if (!percentageMissedBlocksAlert.enabled || windowStats.total === 0) return [];

    const existing = openByType.get("percentage_miss");
    const ratio = (windowStats.missed / windowStats.total) * 100;
    const breached = ratio >= percentageMissedBlocksAlert.threshold;
    const context: AlertContext = {
      ...blockContext(latestBlock),
      windowTotal: windowStats.total,
      windowMissed: windowStats.missed,
      windowMissedPercent: ratio,
      threshold: percentageMissedBlocksAlert.threshold,
    };

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
          context,
        },
      ];
    }
    if (breached && existing != null) {
      if (!percentageMissedBlocksAlert.repeat) return [];
      // Each repeat requires the miss ratio to clear the threshold escalated by 50% per prior repeat.
      const nextThreshold =
        percentageMissedBlocksAlert.threshold * 1.5 ** (existing.repeatCount + 1);
      if (ratio >= nextThreshold) {
        return [{ kind: "repeat", alert: existing, context }];
      }
      return [];
    }
    if (!breached && existing != null) {
      return [{ kind: "close", alert: existing, closedAt: new Date(), context }];
    }
    return [];
  }

  /**
   * Keeps exactly one of the validator status alerts open while the validator is outside the
   * active set, matching the reason:
   *  - tombstoned: jailed permanently (double sign) - will never close on its own.
   *  - jailed: jailed, can unjail after jailedUntil.
   *  - inactive: not jailed, but not in the active set (outranked by stake / smaller set).
   * A change of reason closes the old alert and opens the new one; rejoining closes it.
   * Gated by alertIfInactive. An unknown status (REST API down) changes nothing.
   */
  private checkValidatorStatus(
    status: ValidatorStatus | undefined,
    openByType: Map<string, Alert>,
  ): AlertEvent[] {
    if (!this.cfg.alertIfInactive || status == null) return [];

    let wanted: ValidatorStatusAlert | undefined;
    if (!status.active) {
      wanted = status.permanent ? "tombstoned" : status.jailed ? "jailed" : "inactive";
    }
    const context: AlertContext = {
      latestBlockHeight: status.height.toString(),
      latestBlockTime: status.time,
      bondStatus: status.bondStatus,
      ...(status.jailedUntil != null && !status.permanent
        ? { jailedUntil: status.jailedUntil }
        : {}),
    };

    const events: AlertEvent[] = [];
    for (const type of VALIDATOR_STATUS_ALERTS) {
      const existing = openByType.get(type);
      if (existing != null && type !== wanted) {
        events.push({ kind: "close", alert: existing, closedAt: new Date(), context });
      }
    }
    if (wanted != null && openByType.get(wanted) == null) {
      events.push({
        kind: "open",
        alert: new Alert({
          alertId: Alert.generateId(),
          chainId: this.chainId,
          alertType: wanted,
          openedAt: new Date(),
        }),
        context,
      });
    }
    return events;
  }

  /**
   * rpc_down / api_down: one alert per endpoint (the URL is the alert's subject), for endpoints
   * configured with alertIfDown. Opens when the endpoint's last health check failed, closes once
   * it passes again - or once the endpoint is no longer configured (with alertIfDown).
   * @param endpoints every configured endpoint, with its last known health.
   * @param openAlerts a list of currently open alerts for this chain.
   */
  public evaluateEndpoints(endpoints: EndpointCheck[], openAlerts: Alert[]): AlertEvent[] {
    const events: AlertEvent[] = [];
    const key = (type: string, url: string) => `${type} ${url}`;
    const open = new Map(
      openAlerts
        .filter((a) => (a.alertType === "rpc_down" || a.alertType === "api_down") && a.subject)
        .map((a) => [key(a.alertType, a.subject ?? ""), a]),
    );

    const configured = new Set<string>();
    for (const endpoint of endpoints) {
      const type = `${endpoint.kind}_down`;
      const k = key(type, endpoint.url);
      configured.add(k);
      if (endpoint.alertIfDown && endpoint.healthy === undefined) continue; // not checked yet
      const existing = open.get(k);
      const context: AlertContext = endpoint.reason != null ? { reason: endpoint.reason } : {};
      const down = endpoint.alertIfDown && endpoint.healthy === false;
      if (down && existing == null) {
        events.push({
          kind: "open",
          alert: new Alert({
            alertId: Alert.generateId(),
            chainId: this.chainId,
            alertType: type,
            subject: endpoint.url,
            openedAt: new Date(),
          }),
          context,
        });
      } else if (!down && existing != null) {
        events.push({ kind: "close", alert: existing, closedAt: new Date(), context });
      }
    }
    // Endpoints removed from the config since the alert was opened.
    for (const [k, alert] of open) {
      if (!configured.has(k))
        events.push({ kind: "close", alert, closedAt: new Date(), context: {} });
    }
    return events;
  }
}
