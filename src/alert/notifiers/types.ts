import type { Result } from "@/pkgs/models/result";
import type { AlertContext } from "../types";

export interface AlertNotification {
  chainId: string;
  alertType: string;
  alertId: string;
  kind: "opened" | "closed" | "repeat";
  message: string;
  context: AlertContext;
}

export interface Notifier {
  send(notification: AlertNotification): Promise<Result<void, Error>>;
}

export function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
