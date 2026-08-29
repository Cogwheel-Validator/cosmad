import axios from "axios";
import type { PagerdutyConfigType } from "@/config/notification_types";
import logger from "@/pkgs/logger";
import type { Result } from "@/pkgs/models/result";
import type { AlertNotification, Notifier } from "./types";
import { toError } from "./types";

const log = logger.child({ module: "PagerdutyNotifier" });

const PAGERDUTY_EVENTS_URL = "https://events.pagerduty.com/v2/enqueue";

export class PagerdutyNotifier implements Notifier {
  constructor(private cfg: PagerdutyConfigType) {}

  async send(notification: AlertNotification): Promise<Result<void, Error>> {
    const eventAction = notification.kind === "closed" ? "resolve" : "trigger";
    try {
      await axios.post(PAGERDUTY_EVENTS_URL, {
        routing_key: this.cfg.serviceKey,
        event_action: eventAction,
        dedup_key: notification.alertId,
        payload: {
          summary: notification.message,
          source: notification.chainId,
          severity: eventAction === "resolve" ? "info" : "critical",
          custom_details: notification.context,
        },
      });
      return { ok: true, value: undefined };
    } catch (error) {
      log.error("Failed to send PagerDuty notification: %s", error);
      return { ok: false, error: toError(error) };
    }
  }
}
