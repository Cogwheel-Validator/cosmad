import axios from "axios";
import type { TelegramConfigType } from "@/config/notification_types";
import logger from "@/pkgs/logger";
import type { Result } from "@/pkgs/models/result";
import type { AlertNotification, Notifier } from "./types";
import { toError } from "./types";

const log = logger.child({ module: "TelegramNotifier" });

export class TelegramNotifier implements Notifier {
  constructor(private cfg: TelegramConfigType) {}

  async send(notification: AlertNotification): Promise<Result<void, Error>> {
    const url = `https://api.telegram.org/bot${this.cfg.botToken}/sendMessage`;
    try {
      await axios.post(url, { chat_id: this.cfg.chatId, text: notification.message });
      return { ok: true, value: undefined };
    } catch (error) {
      log.error("Failed to send Telegram notification: %s", error);
      return { ok: false, error: toError(error) };
    }
  }
}
