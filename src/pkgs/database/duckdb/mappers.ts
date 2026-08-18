import {
  blobValue,
  DuckDBBlobValue,
  DuckDBTimestampValue,
  type DuckDBValue,
} from "@duckdb/node-api";
import { BlockWindowStats, ChainSignatureStats } from "../analytics";
import { Alert, Block } from "../tables";

export interface BlockRow {
  chainId: string;
  height: bigint;
  hash: DuckDBBlobValue;
  time: DuckDBTimestampValue;
  signed: number;
  signature: DuckDBBlobValue | null;
}

export function blockToRow(block: Block): BlockRow {
  return {
    chainId: block.chainId,
    height: block.height,
    hash: blobValue(block.hash),
    time: new DuckDBTimestampValue(BigInt(block.time.getTime()) * 1000n),
    signed: block.signed,
    signature: block.signature != null ? new DuckDBBlobValue(block.signature) : null,
  };
}

export function rowToBlock(data: Record<string, DuckDBValue>, chainType: "bft" | "tm2"): Block {
  return new Block({
    chainId: data.chain_id as string,
    height: data.height as bigint,
    hash: Buffer.from((data.hash as DuckDBBlobValue).bytes),
    time: new Date(Number((data.time as DuckDBTimestampValue).micros) / 1000),
    signed: data.signed as number,
    signature:
      data.signature != null ? Buffer.from((data.signature as DuckDBBlobValue).bytes) : undefined,
    chainType,
  });
}

export interface AlertRow {
  alertId: string;
  chainId: string;
  alertType: string;
  openedAt: DuckDBTimestampValue;
  closedAt: DuckDBTimestampValue | null;
  lastNotifiedAt: DuckDBTimestampValue | null;
  repeatCount: number;
}

export function alertToRow(alert: Alert): AlertRow {
  return {
    alertId: alert.alertId,
    chainId: alert.chainId,
    alertType: alert.alertType,
    openedAt: new DuckDBTimestampValue(BigInt(alert.openedAt.getTime()) * 1000n),
    closedAt:
      alert.closedAt != null
        ? new DuckDBTimestampValue(BigInt(alert.closedAt.getTime()) * 1000n)
        : null,
    lastNotifiedAt:
      alert.lastNotifiedAt != null
        ? new DuckDBTimestampValue(BigInt(alert.lastNotifiedAt.getTime()) * 1000n)
        : null,
    repeatCount: alert.repeatCount,
  };
}

export function rowToAlert(data: Record<string, DuckDBValue>): Alert {
  return new Alert({
    alertId: data.alert_id as string,
    chainId: data.chain_id as string,
    alertType: data.alert_type as string,
    openedAt: new Date(Number((data.opened_at as DuckDBTimestampValue).micros) / 1000),
    repeatCount: Number(data.repeat_count as number),
    ...(data.closed_at != null
      ? { closedAt: new Date(Number((data.closed_at as DuckDBTimestampValue).micros) / 1000) }
      : {}),
    ...(data.last_notified_at != null
      ? {
          lastNotifiedAt: new Date(
            Number((data.last_notified_at as DuckDBTimestampValue).micros) / 1000,
          ),
        }
      : {}),
  });
}

export function rowToSignStats(data: Record<string, DuckDBValue>): ChainSignatureStats {
  return new ChainSignatureStats(
    data.chain_id as string,
    data.signed_blocks as number,
    data.missed_blocks as number,
  );
}

export function rowToBlockWindowStats(data: Record<string, DuckDBValue>): BlockWindowStats {
  return new BlockWindowStats(Number(data.total as number), Number(data.missed as number));
}
