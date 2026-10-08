import { type DuckDBConnection, DuckDBTimestampValue } from "@duckdb/node-api";
import type { Logger } from "pino";
import type { Result } from "../../../models/result";
import type { ValidatorInactivity } from "../../tables";
import { toError } from "../errors";
import { inactivityToRow, rowToInactivity } from "../mappers";

/**
 * Inserts the start of a validator inactivity period. Replaces an existing period starting at
 * the same height (the reason changed again within the same observed height).
 */
export async function insertInactivity(
  conn: DuckDBConnection,
  log: Logger,
  period: ValidatorInactivity,
): Promise<Result<void, Error>> {
  const row = inactivityToRow(period);
  const sql = `
    INSERT OR REPLACE INTO validator_inactivity
      (chain_id, height, time, jailed, permanent, bond_status, jailed_until, end_height, end_time)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  try {
    await conn.run(sql, [
      row.chainId,
      row.height,
      row.time,
      row.jailed,
      row.permanent,
      row.bondStatus,
      row.jailedUntil,
      row.endHeight,
      row.endTime,
    ]);
    return { ok: true, value: undefined };
  } catch (error) {
    log.error("Error inserting validator inactivity for %s: %s", period.chainId, error);
    return { ok: false, error: toError(error) };
  }
}

/** Returns the ongoing (not yet ended) inactivity period of a chain's validator, if any. */
export async function getOpenInactivity(
  conn: DuckDBConnection,
  log: Logger,
  chainId: string,
): Promise<Result<ValidatorInactivity | null, Error>> {
  const sql = `
    SELECT chain_id, height, time, jailed, permanent, bond_status, jailed_until, end_height, end_time
    FROM validator_inactivity
    WHERE chain_id = ? AND end_height IS NULL
    ORDER BY height DESC
    LIMIT 1`;
  try {
    const result = await conn.runAndReadAll(sql, [chainId]);
    const rows = result.getRowObjects();
    return { ok: true, value: rows.length > 0 ? rowToInactivity(rows[0]) : null };
  } catch (error) {
    log.error("Error getting open validator inactivity for %s: %s", chainId, error);
    return { ok: false, error: toError(error) };
  }
}

/** Returns a chain's inactivity periods, newest first. */
export async function getInactivityHistory(
  conn: DuckDBConnection,
  log: Logger,
  chainId: string,
  limit: number,
): Promise<Result<ValidatorInactivity[], Error>> {
  const sql = `
    SELECT chain_id, height, time, jailed, permanent, bond_status, jailed_until, end_height, end_time
    FROM validator_inactivity
    WHERE chain_id = ?
    ORDER BY height DESC
    LIMIT ?`;
  try {
    const result = await conn.runAndReadAll(sql, [chainId, limit]);
    return { ok: true, value: result.getRowObjects().map((row) => rowToInactivity(row)) };
  } catch (error) {
    log.error("Error getting validator inactivity history for %s: %s", chainId, error);
    return { ok: false, error: toError(error) };
  }
}

/** Ends the inactivity period that started at `startHeight`. */
export async function endInactivity(
  conn: DuckDBConnection,
  log: Logger,
  chainId: string,
  startHeight: bigint,
  endHeight: bigint,
  endTime: Date,
): Promise<Result<void, Error>> {
  const sql = `
    UPDATE validator_inactivity SET end_height = ?, end_time = ?
    WHERE chain_id = ? AND height = ?`;
  try {
    await conn.run(sql, [
      endHeight,
      new DuckDBTimestampValue(BigInt(endTime.getTime()) * 1000n),
      chainId,
      startHeight,
    ]);
    return { ok: true, value: undefined };
  } catch (error) {
    log.error("Error ending validator inactivity for %s: %s", chainId, error);
    return { ok: false, error: toError(error) };
  }
}
