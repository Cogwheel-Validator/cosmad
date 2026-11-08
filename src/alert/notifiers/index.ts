import { randomUUID } from "node:crypto";
import type { AlertConfig } from "@/config/alert_types";
import type { ConfigLoaderData } from "@/config/config_loader";
import type { IWriteDb } from "@/pkgs/database/interfaces";
import { NotificationOutbox } from "@/pkgs/database/tables";
import logger from "@/pkgs/logger";
import type { Result } from "@/pkgs/models/result";
import type { AlertContext, AlertEvent } from "../types";
import { DiscordNotifier } from "./discord";
import { PagerdutyNotifier } from "./pagerduty";
import { TelegramNotifier } from "./telegram";
import type { AlertNotification, Notifier } from "./types";

type AlertConfigType = typeof AlertConfig.infer;
type GlobalAlertsConfig = ConfigLoaderData["globalAlerts"];

const log = logger.child({ module: "NotificationDispatcher" });

// Retry policy. A "round" is SEND_ATTEMPTS quick attempts against one notifier. If a whole round
// fails the notification stays in the outbox and the next round only starts after a pause that
// doubles with every failed round (up to a cap), for as long as it takes to get through.
const SEND_ATTEMPTS = 3;
const SEND_RETRY_DELAY_MS = 500;
const RETRY_PAUSE_MS = 5 * 60_000;
const MAX_RETRY_PAUSE_MS = 60 * 60_000;
// How often the outbox is checked for notifications that are due again.
const DELIVERY_INTERVAL_MS = 10_000;
// Delivered notifications are kept this long for inspection before being pruned.
const RETENTION_MS = 7 * 24 * 3_600_000;
const PRUNE_INTERVAL_MS = 3_600_000;
const PENDING_LIMIT = 500;

export interface NamedNotifier {
  name: string;
  notifier: Notifier;
}

export interface DispatcherOptions {
  notifiers?: NamedNotifier[];
  sendRetryDelayMs?: number;
  retryPauseMs?: number;
  maxRetryPauseMs?: number;
  deliveryIntervalMs?: number;
}

/** The pause before the next round after `failedRounds` rounds have failed: base, 2x, 4x, ... capped. */
export function retryPause(failedRounds: number, baseMs: number, maxMs: number): number {
  return Math.min(baseMs * 2 ** Math.max(0, failedRounds - 1), maxMs);
}

export class NotificationDispatcher {
  private notifiers: NamedNotifier[];
  private sendRetryDelayMs: number;
  private retryPauseMs: number;
  private maxRetryPauseMs: number;
  private deliveryIntervalMs: number;
  // Delivery passes are chained so they never overlap (which would double-send a notification).
  private delivering: Promise<void> = Promise.resolve();
  private lastPrune = 0;

  constructor(
    chainAlertConfig: AlertConfigType,
    globalAlerts: GlobalAlertsConfig,
    private db: IWriteDb,
    options: DispatcherOptions = {},
  ) {
    this.sendRetryDelayMs = options.sendRetryDelayMs ?? SEND_RETRY_DELAY_MS;
    this.retryPauseMs =
      options.retryPauseMs ??
      (chainAlertConfig.notifyRetryPause != null
        ? chainAlertConfig.notifyRetryPause * 1000
        : RETRY_PAUSE_MS);
    // Never below the base pause, whichever of the two the user set.
    this.maxRetryPauseMs = Math.max(
      this.retryPauseMs,
      options.maxRetryPauseMs ??
        (chainAlertConfig.notifyRetryMaxPause != null
          ? chainAlertConfig.notifyRetryMaxPause * 1000
          : MAX_RETRY_PAUSE_MS),
    );
    this.deliveryIntervalMs = options.deliveryIntervalMs ?? DELIVERY_INTERVAL_MS;

    if (options.notifiers) {
      this.notifiers = options.notifiers;
      return;
    }
    this.notifiers = [];

    const telegramCfg = chainAlertConfig.telegram ?? globalAlerts.telegram;
    if (telegramCfg?.enabled)
      this.notifiers.push({ name: "telegram", notifier: new TelegramNotifier(telegramCfg) });

    const discordCfg = chainAlertConfig.discord ?? globalAlerts.discord;
    if (discordCfg?.enabled)
      this.notifiers.push({ name: "discord", notifier: new DiscordNotifier(discordCfg) });

    const pagerdutyCfg = chainAlertConfig.pagerduty ?? globalAlerts.pagerduty;
    if (pagerdutyCfg?.enabled)
      this.notifiers.push({ name: "pagerduty", notifier: new PagerdutyNotifier(pagerdutyCfg) });
  }

  /**
   * Persists the event's notification, one outbox row per notifier, so it is delivered even if
   * the notifier is down for a while or the process restarts. Call before applying the event's
   * state change: a crash in between then re-sends (at least once) instead of losing it.
   * If the outbox itself can't be written the notification is sent directly, best effort.
   */
  async enqueue(event: AlertEvent, chainId: string): Promise<void> {
    if (this.notifiers.length === 0) return;
    const notification = buildNotification(event, chainId);
    const now = new Date();
    const payload = JSON.stringify(notification);
    const rows = this.notifiers.map(
      ({ name }) =>
        new NotificationOutbox({
          id: randomUUID(),
          chainId,
          alertId: notification.alertId,
          notifier: name,
          kind: notification.kind,
          payload,
          nextAttemptAt: now,
          createdAt: now,
        }),
    );
    const r = await this.db.enqueueNotifications(rows);
    if (r.ok) return;
    log.error("Failed to enqueue notifications for alert %s: %s", notification.alertId, r.error);
    await Promise.all(
      this.notifiers.map(async ({ name, notifier }) => {
        const sent = await this.sendRound(notifier, notification);
        if (!sent.ok) {
          log.error("Notifier %s failed for alert %s: %s", name, notification.alertId, sent.error);
        }
      }),
    );
  }

  /** Attempts every notification that is due. Safe to call at any time and from anywhere. */
  deliverPending(): Promise<void> {
    this.delivering = this.delivering.then(() =>
      this.deliverPass().catch((err: unknown) => log.error("Delivery pass failed: %s", err)),
    );
    return this.delivering;
  }

  /** Starts the periodic delivery of due/retried notifications. Returns the stop function. */
  start(): () => void {
    void this.deliverPending(); // anything left over from before a restart
    const timer = setInterval(() => void this.deliverPending(), this.deliveryIntervalMs);
    return () => clearInterval(timer);
  }

  private async deliverPass(): Promise<void> {
    const pending = await this.db.getPendingNotifications(PENDING_LIMIT);
    if (!pending.ok) {
      log.error("Failed to read pending notifications: %s", pending.error);
      return;
    }

    // Per (alert, notifier) the rows are delivered strictly in order, so "closed" can never
    // overtake an "opened" that is still waiting for its next round. Groups are independent.
    const groups = new Map<string, NotificationOutbox[]>();
    for (const row of pending.value) {
      const key = `${row.alertId}\0${row.notifier}`;
      const group = groups.get(key);
      if (group) group.push(row);
      else groups.set(key, [row]);
    }
    await Promise.all([...groups.values()].map((rows) => this.deliverGroup(rows)));

    const now = Date.now();
    if (now - this.lastPrune >= PRUNE_INTERVAL_MS) {
      this.lastPrune = now;
      const r = await this.db.pruneNotifications(new Date(now - RETENTION_MS));
      if (!r.ok) log.error("Failed to prune notifications: %s", r.error);
    }
  }

  private async deliverGroup(rows: NotificationOutbox[]): Promise<void> {
    for (const row of rows) {
      if (await this.dropIfObsolete(row)) continue;
      if (row.nextAttemptAt.getTime() > Date.now()) return;
      const named = this.notifiers.find((n) => n.name === row.notifier);
      // named is always set here: dropIfObsolete already handled the missing case.
      if (!named) return;

      const result = await this.sendRound(named.notifier, JSON.parse(row.payload));
      if (result.ok) {
        const r = await this.db.markNotificationDelivered(row.id, new Date());
        if (!r.ok) log.error("Failed to mark notification %s delivered: %s", row.id, r.error);
        continue;
      }

      const failedRounds = row.failedRounds + 1;
      const pause = retryPause(failedRounds, this.retryPauseMs, this.maxRetryPauseMs);
      log.warn(
        "Notifier %s failed for alert %s (round %d), retrying in %ds: %s",
        row.notifier,
        row.alertId,
        failedRounds,
        Math.round(pause / 1000),
        result.error,
      );
      const r = await this.db.markNotificationFailed(
        row.id,
        failedRounds,
        new Date(Date.now() + pause),
        result.error.message,
      );
      if (!r.ok) log.error("Failed to reschedule notification %s: %s", row.id, r.error);
      return; // later rows of this alert/notifier wait for this one
    }
  }

  /** Drops (marks done without sending) a notification that no longer makes sense to send. */
  private async dropIfObsolete(row: NotificationOutbox): Promise<boolean> {
    let reason: string | undefined;
    if (!this.notifiers.some((n) => n.name === row.notifier)) {
      reason = `skipped: ${row.notifier} is no longer configured`;
    } else if (row.kind !== "closed") {
      // A late "opened"/"still open" for an alert that has since cleared would only mislead.
      const alert = await this.db.getAlert(row.alertId);
      if (alert.ok && alert.value?.closedAt != null) reason = "skipped: alert closed meanwhile";
    }
    if (reason == null) return false;
    const r = await this.db.markNotificationDelivered(row.id, new Date(), reason);
    if (!r.ok) log.error("Failed to drop notification %s: %s", row.id, r.error);
    return r.ok;
  }

  /** One round: up to SEND_ATTEMPTS quick attempts, with a short growing delay in between. */
  private async sendRound(
    notifier: Notifier,
    notification: AlertNotification,
  ): Promise<Result<void, Error>> {
    let last: Result<void, Error> = { ok: false, error: new Error("not attempted") };
    for (let attempt = 1; attempt <= SEND_ATTEMPTS; attempt++) {
      last = await notifier.send(notification);
      if (last.ok) return last;
      if (attempt < SEND_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, this.sendRetryDelayMs * attempt));
      }
    }
    return last;
  }
}

/**
 * Renders an AlertContext into a short human-readable clause describing the chain's
 * current state which is appended as a comment, or description depending on the notification
 * service.
 * @param alertType The type of alert being evaluated.
 * @param context The alert context containing the chain's current state.
 * @returns A human-readable string describing the chain's current state.
 */
function formatAlertDetails(alertType: string, context: AlertContext): string {
  const details: string[] = [];
  switch (alertType) {
    case "percentage_miss":
      if (context.windowMissedPercent != null && context.windowTotal != null) {
        details.push(
          `${context.windowMissedPercent.toFixed(2)}% missed over the last ${context.windowTotal} blocks ` +
            `(${context.windowMissed}/${context.windowTotal}, threshold ${context.threshold}%)`,
        );
      }
      break;
    case "consecutive_miss":
      if (context.consecutiveMissed != null) {
        details.push(
          `${context.consecutiveMissed} consecutive misses (threshold ${context.threshold})`,
        );
      }
      break;
    case "stalled":
      if (context.threshold != null) {
        details.push(`no new block seen in over ${context.threshold}s`);
      }
      break;
    case "rpc_down":
    case "api_down":
      if (context.reason != null) details.push(context.reason);
      break;
    case "inactive":
      details.push(
        `not jailed, but outside the active set${context.bondStatus != null ? ` (${context.bondStatus})` : ""}`,
      );
      break;
    case "jailed":
      details.push(
        context.jailedUntil != null
          ? `validator jailed until ${context.jailedUntil.toISOString()}`
          : "validator jailed",
      );
      break;
    case "tombstoned":
      details.push("validator tombstoned - permanently jailed, cannot unjail");
      break;
  }
  if (context.latestBlockHeight != null) {
    const time =
      context.latestBlockTime != null ? ` at ${context.latestBlockTime.toISOString()}` : "";
    details.push(`latest known block ${context.latestBlockHeight}${time}`);
  }
  return details.length > 0 ? ` (${details.join("; ")})` : "";
}

export function buildNotification(event: AlertEvent, chainId: string): AlertNotification {
  const { alert, context } = event;
  const details = formatAlertDetails(alert.alertType, context);
  const what = alert.subject != null ? `${alert.alertType} ${alert.subject}` : alert.alertType;
  switch (event.kind) {
    case "open":
      return {
        chainId,
        alertType: alert.alertType,
        alertId: alert.alertId,
        kind: "opened",
        context,
        message: `[${chainId}] Alert opened: ${what}${details}`,
      };
    case "repeat":
      return {
        chainId,
        alertType: alert.alertType,
        alertId: alert.alertId,
        kind: "repeat",
        context,
        message: `[${chainId}] Alert still open (repeat #${alert.repeatCount + 1}): ${what}${details}`,
      };
    case "close":
      return {
        chainId,
        alertType: alert.alertType,
        alertId: alert.alertId,
        kind: "closed",
        context,
        message: `[${chainId}] Alert closed: ${what}${details}`,
      };
  }
}
