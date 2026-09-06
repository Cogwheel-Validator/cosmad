import { type DuckDBConnection, DuckDBTimestampValue } from "@duckdb/node-api";
import type { Logger } from "pino";
import type { Result } from "../../../models/result";
import type { Alert } from "../../tables";
import { toError } from "../errors";
import { alertToRow, rowToAlert } from "../mappers";

/**
 * insertAlert inserts an alert into the database
 * @param alert data containing all alert information
 * @returns promise wrapped result of the insert
 */
export async function insertAlert(
  conn: DuckDBConnection,
  log: Logger,
  alert: Alert,
): Promise<Result<void, Error>> {
  log.debug("Inserting alert %s into the database", alert.alertId);
  const row = alertToRow(alert);
  const sql = `
    INSERT INTO alerts
      (alert_id, chain_id, alert_type, opened_at, closed_at, last_notified_at, repeat_count)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `;
  const values = [
    row.alertId,
    row.chainId,
    row.alertType,
    row.openedAt,
    row.closedAt,
    row.lastNotifiedAt,
    row.repeatCount,
  ];
  try {
    await conn.run(sql, values);
    log.info("Alert %s inserted successfully", alert.alertId);
    return { ok: true, value: undefined };
  } catch (error) {
    log.error("Error inserting alert %s: %s", alert.alertId, error);
    return { ok: false, error: toError(error) };
  }
}

export async function getAlert(
  conn: DuckDBConnection,
  log: Logger,
  alertKey: string,
): Promise<Result<Alert | null, Error>> {
  const sql = `
    SELECT
      alert_id,
      chain_id,
      alert_type,
      opened_at,
      closed_at,
      last_notified_at,
      repeat_count
    FROM alerts
    WHERE alert_id = ?
    LIMIT 1`;
  try {
    const result = await conn.runAndReadAll(sql, [alertKey]);
    const rows = result.getRowObjects();
    if (rows.length === 0) {
      return { ok: true, value: null };
    }
    return { ok: true, value: rowToAlert(rows[0]) };
  } catch (error) {
    log.error("Error getting alert %s: %s", alertKey, error);
    return { ok: false, error: toError(error) };
  }
}

export async function getUnclosedAlerts(
  conn: DuckDBConnection,
  log: Logger,
  chainId: string,
  limit: number,
  page: number,
): Promise<Result<Alert[], Error>> {
  const sql = `
    SELECT
      alert_id,
      chain_id,
      alert_type,
      opened_at,
      closed_at,
      last_notified_at,
      repeat_count
    FROM alerts
    WHERE
      chain_id = ? AND
      closed_at IS NULL
    ORDER BY opened_at ASC
    LIMIT ? OFFSET ?`;
  try {
    const result = await conn.runAndReadAll(sql, [chainId, limit, (page - 1) * limit]);
    const rows = result.getRowObjects();
    return { ok: true, value: rows.map((row) => rowToAlert(row)) };
  } catch (error) {
    log.error("Error getting unclosed alerts: %s", error);
    return { ok: false, error: toError(error) };
  }
}

export async function closeAlert(
  conn: DuckDBConnection,
  log: Logger,
  alertId: string,
  closedAt: Date,
): Promise<Result<void, Error>> {
  const ts = new DuckDBTimestampValue(BigInt(closedAt.getTime()) * 1000n);
  const sql = `UPDATE alerts SET closed_at = ? WHERE alert_id = ?`;
  try {
    await conn.run(sql, [ts, alertId]);
    log.info("Alert %s closed at %s", alertId, closedAt.toISOString());
    return { ok: true, value: undefined };
  } catch (error) {
    log.error("Error closing alert %s: %s", alertId, error);
    return { ok: false, error: toError(error) };
  }
}

/**
 * touchAlertNotified updates the last notified at date and repeat count for the alert
 * @param alertId unique alert id
 * @param notifiedAt notified at date
 * @param repeatCount repeat count
 * @returns a promise wrapped result of the update
 */
export async function touchAlertNotified(
  conn: DuckDBConnection,
  log: Logger,
  alertId: string,
  notifiedAt: Date,
  repeatCount: number,
): Promise<Result<void, Error>> {
  const ts = new DuckDBTimestampValue(BigInt(notifiedAt.getTime()) * 1000n);
  const sql = `UPDATE alerts SET last_notified_at = ?, repeat_count = ? WHERE alert_id = ?`;
  try {
    await conn.run(sql, [ts, repeatCount, alertId]);
    log.debug("Alert %s marked notified (repeatCount=%d)", alertId, repeatCount);
    return { ok: true, value: undefined };
  } catch (error) {
    log.error("Error touching alert %s: %s", alertId, error);
    return { ok: false, error: toError(error) };
  }
}
