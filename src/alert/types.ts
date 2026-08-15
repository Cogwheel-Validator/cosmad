import type { Alert } from "@/pkgs/database/tables";

export type AlertEvent =
  | { kind: "open"; alert: Alert }
  | { kind: "close"; alert: Alert; closedAt: Date }
  | { kind: "repeat"; alert: Alert };
  
