import type { DailyBlockStats } from "../pkgs/database/analytics";
import type { Alert, Block } from "../pkgs/database/tables";

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

export type SseEvent =
  | { type: "block"; chainId: string; data: BlockJson }
  | { type: "alert_opened"; chainId: string; data: AlertJson }
  | { type: "alert_closed"; chainId: string; alertId: string }
  | { type: "chain_status"; chainId: string; status: "online" | "offline" }
  | { type: "ping" };

export function serializeBlock(block: Block): BlockJson {
  return {
    height: block.height.toString(),
    hash: block.hash.toString("hex"),
    time: block.time.toISOString(),
    signed: block.signed,
    signature: block.signature?.toString("hex") ?? null,
  };
}

export function serializeAlert(alert: Alert): AlertJson {
  return {
    alertId: alert.alertId,
    chainId: alert.chainId,
    alertType: alert.alertType,
    openedAt: alert.openedAt.toISOString(),
    closedAt: alert.closedAt?.toISOString() ?? null,
  };
}

export interface DailyStatsJson {
  date: string;
  total: number;
  missed: number;
  percentageSigned: number | null;
}

function percentageSigned(total: number, missed: number): number | null {
  return total > 0 ? (total - missed) / total : null;
}

export function serializeDailyStats(stats: DailyBlockStats): DailyStatsJson {
  return {
    date: stats.date,
    total: stats.total,
    missed: stats.missed,
    percentageSigned: percentageSigned(stats.total, stats.missed),
  };
}

export interface ChainStatsJson {
  chainId: string;
  days: number;
  totalBlocks: number;
  missedBlocks: number;
  percentageSigned: number | null;
  daily: DailyStatsJson[];
}

export function buildChainStats(
  chainId: string,
  days: number,
  daily: DailyBlockStats[],
): ChainStatsJson {
  const totalBlocks = daily.reduce((sum, d) => sum + d.total, 0);
  const missedBlocks = daily.reduce((sum, d) => sum + d.missed, 0);
  return {
    chainId,
    days,
    totalBlocks,
    missedBlocks,
    percentageSigned: percentageSigned(totalBlocks, missedBlocks),
    daily: daily.map(serializeDailyStats),
  };
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
