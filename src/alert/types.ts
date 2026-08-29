import type { Alert } from "@/pkgs/database/tables";

/**
 * Snapshot of chain state at the moment an alert was evaluated, carried through to
 * notifications.
 */
export interface AlertContext {
  latestBlockHeight?: string;
  latestBlockTime?: Date;
  windowTotal?: number;
  windowMissed?: number;
  windowMissedPercent?: number;
  consecutiveMissed?: number;
  threshold?: number;
}

export type AlertEvent =
  | { kind: "open"; alert: Alert; context: AlertContext }
  | { kind: "close"; alert: Alert; closedAt: Date; context: AlertContext }
  | { kind: "repeat"; alert: Alert; context: AlertContext };
