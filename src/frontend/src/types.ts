export interface BlockJson {
  height: string;
  hash: string;
  time: string;
  signed: boolean;
  signature: string | null;
}

export interface AlertJson {
  alertId: string;
  chainId: string;
  alertType: string;
  openedAt: string;
  closedAt: string | null;
}

export type SseEvent =
  | { type: "block"; chainId: string; data: BlockJson }
  | { type: "alert_opened"; chainId: string; data: AlertJson }
  | { type: "alert_closed"; chainId: string; alertId: string }
  | { type: "chain_status"; chainId: string; status: "online" | "offline" }
  | { type: "ping" };
