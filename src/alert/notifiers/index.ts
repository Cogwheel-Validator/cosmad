import type { AlertConfig } from "@/config/alert_types";
import type { ConfigLoaderData } from "@/config/config_loader";
import logger from "@/pkgs/logger";
import type { AlertContext, AlertEvent } from "../types";
import { DiscordNotifier } from "./discord";
import { PagerdutyNotifier } from "./pagerduty";
import { TelegramNotifier } from "./telegram";
import type { AlertNotification, Notifier } from "./types";

type AlertConfigType = typeof AlertConfig.infer;
type GlobalAlertsConfig = ConfigLoaderData["globalAlerts"];

const log = logger.child({ module: "NotificationDispatcher" });

// Small retry policy for a single notifier send
const SEND_RETRY_ATTEMPTS = 3;
const SEND_RETRY_DELAY_MS = 500;

async function sendWithRetry(
  notifier: Notifier,
  notification: AlertNotification,
  chainId: string,
): Promise<void> {
  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= SEND_RETRY_ATTEMPTS; attempt++) {
    const result = await notifier.send(notification);
    if (result.ok) return;
    lastError = result.error;
    if (attempt < SEND_RETRY_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, SEND_RETRY_DELAY_MS * attempt));
    }
  }
  log.error(
    "Notifier failed for alert %s on %s after %d attempts: %s",
    notification.alertId,
    chainId,
    SEND_RETRY_ATTEMPTS,
    lastError,
  );
}

export class NotificationDispatcher {
  private notifiers: Notifier[];

  constructor(chainAlertConfig: AlertConfigType, globalAlerts: GlobalAlertsConfig) {
    this.notifiers = [];

    const telegramCfg = chainAlertConfig.telegram ?? globalAlerts.telegram;
    if (telegramCfg?.enabled) this.notifiers.push(new TelegramNotifier(telegramCfg));

    const discordCfg = chainAlertConfig.discord ?? globalAlerts.discord;
    if (discordCfg?.enabled) this.notifiers.push(new DiscordNotifier(discordCfg));

    const pagerdutyCfg = chainAlertConfig.pagerduty ?? globalAlerts.pagerduty;
    if (pagerdutyCfg?.enabled) this.notifiers.push(new PagerdutyNotifier(pagerdutyCfg));
  }

  async dispatch(event: AlertEvent, chainId: string): Promise<void> {
    if (this.notifiers.length === 0) return;
    const notification = buildNotification(event, chainId);
    await Promise.all(
      this.notifiers.map((notifier) => sendWithRetry(notifier, notification, chainId)),
    );
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
  switch (event.kind) {
    case "open":
      return {
        chainId,
        alertType: alert.alertType,
        alertId: alert.alertId,
        kind: "opened",
        context,
        message: `[${chainId}] Alert opened: ${alert.alertType}${details}`,
      };
    case "repeat":
      return {
        chainId,
        alertType: alert.alertType,
        alertId: alert.alertId,
        kind: "repeat",
        context,
        message: `[${chainId}] Alert still open (repeat #${alert.repeatCount + 1}): ${alert.alertType}${details}`,
      };
    case "close":
      return {
        chainId,
        alertType: alert.alertType,
        alertId: alert.alertId,
        kind: "closed",
        context,
        message: `[${chainId}] Alert closed: ${alert.alertType}${details}`,
      };
  }
}
