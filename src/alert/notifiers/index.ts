import type { AlertConfig } from "@/config/alert_types";
import type { ConfigLoaderData } from "@/config/config_loader";
import logger from "@/pkgs/logger";
import type { AlertEvent } from "../types";
import { DiscordNotifier } from "./discord";
import { HealthCheckNotifier } from "./healthcheck";
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
  private healthCheckNotifier: HealthCheckNotifier | undefined;
  private healthCheckInterval: number = 60000;
  private isRunning: boolean = false; // shutdown

  constructor(chainAlertConfig: AlertConfigType, globalAlerts: GlobalAlertsConfig) {
    this.notifiers = [];

    const telegramCfg = chainAlertConfig.telegram ?? globalAlerts.telegram;
    if (telegramCfg?.enabled) this.notifiers.push(new TelegramNotifier(telegramCfg));

    const discordCfg = chainAlertConfig.discord ?? globalAlerts.discord;
    if (discordCfg?.enabled) this.notifiers.push(new DiscordNotifier(discordCfg));

    const pagerdutyCfg = chainAlertConfig.pagerduty ?? globalAlerts.pagerduty;
    if (pagerdutyCfg?.enabled) this.notifiers.push(new PagerdutyNotifier(pagerdutyCfg));

    const healthCheckCfg = globalAlerts.healthCheck;
    if (healthCheckCfg?.enabled) {
      this.healthCheckNotifier = new HealthCheckNotifier(healthCheckCfg);
      this.healthCheckInterval = healthCheckCfg.ping * 1000;
      this.isRunning = true;
    }

    // initiate the healthcheck ping
    if (this.healthCheckNotifier) this.healthCheckNotifier.sendStartPing(10000);
  }

  async pingHealthcheck(): Promise<void> {
    while (this.isRunning && this.healthCheckNotifier) {
      try {
        this.healthCheckNotifier.sendSuccessPing(10000);
      } catch (e) {
        log.error("Failed to send healthcheck ping: %s", e);
      }
      await new Promise((resolve) => setTimeout(resolve, this.healthCheckInterval));
    }
  }

  async dispatch(event: AlertEvent, chainId: string): Promise<void> {
    if (this.notifiers.length === 0) return;
    const notification = buildNotification(event, chainId);
    await Promise.all(
      this.notifiers.map((notifier) => sendWithRetry(notifier, notification, chainId)),
    );
  }

  public close(): void {
    this.isRunning = false;
  }
}

function buildNotification(event: AlertEvent, chainId: string): AlertNotification {
  const { alert } = event;
  switch (event.kind) {
    case "open":
      return {
        chainId,
        alertType: alert.alertType,
        alertId: alert.alertId,
        kind: "opened",
        message: `[${chainId}] Alert opened: ${alert.alertType}`,
      };
    case "repeat":
      return {
        chainId,
        alertType: alert.alertType,
        alertId: alert.alertId,
        kind: "repeat",
        message: `[${chainId}] Alert still open (repeat #${alert.repeatCount + 1}): ${alert.alertType}`,
      };
    case "close":
      return {
        chainId,
        alertType: alert.alertType,
        alertId: alert.alertId,
        kind: "closed",
        message: `[${chainId}] Alert closed: ${alert.alertType}`,
      };
  }
}
