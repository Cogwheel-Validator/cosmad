export interface BlockJson {
  height: string;
  hash: string;
  time: string;
  signed: number;
  signature: string | null;
}

export interface AlertJson {
  alertId: string;
  chainId: string;
  alertType: string;
  openedAt: string;
  closedAt: string | null;
}

export interface DailyStatsJson {
  date: string;
  total: number;
  missed: number;
  percentageSigned: number | null;
}

export interface ChainStatsJson {
  chainId: string;
  days: number;
  totalBlocks: number;
  missedBlocks: number;
  percentageSigned: number | null;
  daily: DailyStatsJson[];
}

export type ChainStatus = "online" | "stalled";

export interface ChainOverviewJson {
  chainId: string;
  prettyName: string;
  chainLogo: string | null;
  status: ChainStatus;
  latestHeight: string | null;
  latestBlockTime: string | null;
  totalBlocks: number;
  missedBlocks: number;
  percentageSigned: number | null;
}

export interface OverviewJson {
  days: number;
  chains: ChainOverviewJson[];
  combined: {
    totalBlocks: number;
    missedBlocks: number;
    percentageSigned: number | null;
    daily: DailyStatsJson[];
  };
}

export type SseEvent =
  | { type: "block"; chainId: string; data: BlockJson }
  | { type: "alert_opened"; chainId: string; data: AlertJson }
  | { type: "alert_closed"; chainId: string; alertId: string }
  | { type: "chain_status"; chainId: string; status: "online" | "offline" }
  | { type: "ping" };
