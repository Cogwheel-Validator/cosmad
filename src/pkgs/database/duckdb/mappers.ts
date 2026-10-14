import {
  blobValue,
  DuckDBBlobValue,
  DuckDBTimestampValue,
  type DuckDBValue,
} from "@duckdb/node-api";
import { BlockWindowStats, ChainSignatureStats, DailyBlockStats } from "../analytics";
import { Alert, Block, ValidatorInactivity } from "../tables";

export interface BlockRow {
  chainId: string;
  height: bigint;
  hash: DuckDBBlobValue;
  time: DuckDBTimestampValue;
  signed: number;
  signature: DuckDBBlobValue | null;
  precommitted: boolean | null;
}

export function blockToRow(block: Block): BlockRow {
  return {
    chainId: block.chainId,
    height: block.height,
    hash: blobValue(block.hash),
    time: new DuckDBTimestampValue(BigInt(block.time.getTime()) * 1000n),
    signed: block.signed,
    signature: block.signature != null ? new DuckDBBlobValue(block.signature) : null,
    precommitted: block.precommitted ?? null,
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
    precommitted: data.precommitted != null ? (data.precommitted as boolean) : undefined,
  });
}

export interface AlertRow {
  alertId: string;
  chainId: string;
  alertType: string;
  subject: string | null;
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
    subject: alert.subject ?? null,
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
    ...(data.subject != null ? { subject: data.subject as string } : {}),
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

export function rowToSignStats(
  data: Record<string, DuckDBValue>,
  chainId: string,
): ChainSignatureStats {
  const total = Number(data.total as number);
  const missed = Number(data.missed as number);
  return new ChainSignatureStats(chainId, (total - missed) / total, missed / total);
}

export function rowToBlockWindowStats(data: Record<string, DuckDBValue>): BlockWindowStats {
  return new BlockWindowStats(Number(data.total as number), Number(data.missed as number));
}

export function rowToDailyBlockStats(data: Record<string, DuckDBValue>): DailyBlockStats {
  const day = data.day as DuckDBTimestampValue;
  const date = new Date(Number(day.micros) / 1000).toISOString().slice(0, 10);
  return new DailyBlockStats(date, Number(data.total as number), Number(data.missed as number));
}

function toTimestamp(date: Date): DuckDBTimestampValue {
  return new DuckDBTimestampValue(BigInt(date.getTime()) * 1000n);
}

function fromTimestamp(value: DuckDBValue): Date {
  return new Date(Number((value as DuckDBTimestampValue).micros) / 1000);
}

export interface ValidatorInactivityRow {
  chainId: string;
  height: bigint;
  time: DuckDBTimestampValue;
  jailed: boolean;
  permanent: boolean;
  bondStatus: string;
  jailedUntil: DuckDBTimestampValue | null;
  endHeight: bigint | null;
  endTime: DuckDBTimestampValue | null;
}

export function inactivityToRow(period: ValidatorInactivity): ValidatorInactivityRow {
  return {
    chainId: period.chainId,
    height: period.height,
    time: toTimestamp(period.time),
    jailed: period.jailed,
    permanent: period.permanent,
    bondStatus: period.bondStatus,
    jailedUntil: period.jailedUntil != null ? toTimestamp(period.jailedUntil) : null,
    endHeight: period.endHeight ?? null,
    endTime: period.endTime != null ? toTimestamp(period.endTime) : null,
  };
}

export function rowToInactivity(data: Record<string, DuckDBValue>): ValidatorInactivity {
  return new ValidatorInactivity({
    chainId: data.chain_id as string,
    height: data.height as bigint,
    time: fromTimestamp(data.time),
    jailed: data.jailed as boolean,
    permanent: data.permanent as boolean,
    bondStatus: data.bond_status as string,
    ...(data.jailed_until != null ? { jailedUntil: fromTimestamp(data.jailed_until) } : {}),
    ...(data.end_height != null ? { endHeight: data.end_height as bigint } : {}),
    ...(data.end_time != null ? { endTime: fromTimestamp(data.end_time) } : {}),
  });
}
