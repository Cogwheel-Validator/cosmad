import axios from "axios";
import type { DiscordConfigType } from "@/config/notification_types";
import logger from "@/pkgs/logger";
import type { Result } from "@/pkgs/models/result";
import type { AlertNotification, Notifier } from "./types";
import { toError } from "./types";

const log = logger.child({ module: "DiscordNotifier" });

export class DiscordNotifier implements Notifier {
  constructor(private cfg: DiscordConfigType) {}

  async send(notification: AlertNotification): Promise<Result<void, Error>> {
    try {
      await axios.post(this.cfg.webhookUrl, { content: notification.message });
      return { ok: true, value: undefined };
    } catch (error) {
      log.error("Failed to send Discord notification: %s", error);
      return { ok: false, error: toError(error) };
    }
  }
}
