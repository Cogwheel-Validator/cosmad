import { type DuckDBConnection, DuckDBTimestampValue } from "@duckdb/node-api";
import type { Logger } from "pino";
import type { Result } from "../../../models/result";
import type { NotificationOutbox } from "../../tables";
import { toError } from "../errors";
import { outboxToRow, rowToOutbox } from "../mappers";

const toTs = (date: Date) => new DuckDBTimestampValue(BigInt(date.getTime()) * 1000n);

export async function enqueueNotifications(
  conn: DuckDBConnection,
  log: Logger,
  items: NotificationOutbox[],
): Promise<Result<void, Error>> {
  if (items.length === 0) return { ok: true, value: undefined };
  const sql = `
    INSERT INTO notification_outbox
      (id, chain_id, alert_id, notifier, kind, payload, failed_rounds, next_attempt_at,
       created_at, delivered_at, last_error)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  try {
    await conn.run("BEGIN TRANSACTION");
    try {
      for (const item of items) {
        const row = outboxToRow(item);
        await conn.run(sql, [
          row.id,
          row.chainId,
          row.alertId,
          row.notifier,
          row.kind,
          row.payload,
          row.failedRounds,
          row.nextAttemptAt,
          row.createdAt,
          row.deliveredAt,
          row.lastError,
        ]);
      }
      await conn.run("COMMIT");
    } catch (error) {
      await conn.run("ROLLBACK");
      throw error;
    }
    return { ok: true, value: undefined };
  } catch (error) {
    log.error("Error enqueueing %d notifications: %s", items.length, error);
    return { ok: false, error: toError(error) };
  }
}

/** Undelivered notifications of a chain, oldest first. */
export async function getPendingNotifications(
  conn: DuckDBConnection,
  log: Logger,
  chainId: string,
  limit: number,
): Promise<Result<NotificationOutbox[], Error>> {
  const sql = `
    SELECT id, chain_id, alert_id, notifier, kind, payload, failed_rounds, next_attempt_at,
           created_at, delivered_at, last_error
    FROM notification_outbox
    WHERE chain_id = ? AND delivered_at IS NULL
    ORDER BY created_at ASC, id ASC
    LIMIT ?`;
  try {
    const result = await conn.runAndReadAll(sql, [chainId, limit]);
    return { ok: true, value: result.getRowObjects().map(rowToOutbox) };
  } catch (error) {
    log.error("Error getting pending notifications for %s: %s", chainId, error);
    return { ok: false, error: toError(error) };
  }
}

/** Marks a notification delivered, or (with a note) dropped without being sent. */
export async function markNotificationDelivered(
  conn: DuckDBConnection,
  log: Logger,
  id: string,
  deliveredAt: Date,
  note?: string,
): Promise<Result<void, Error>> {
  const sql = `UPDATE notification_outbox SET delivered_at = ?, last_error = ? WHERE id = ?`;
  try {
    await conn.run(sql, [toTs(deliveredAt), note ?? null, id]);
    return { ok: true, value: undefined };
  } catch (error) {
    log.error("Error marking notification %s delivered: %s", id, error);
    return { ok: false, error: toError(error) };
  }
}

export async function markNotificationFailed(
  conn: DuckDBConnection,
  log: Logger,
  id: string,
  failedRounds: number,
  nextAttemptAt: Date,
  error: string,
): Promise<Result<void, Error>> {
  const sql = `
    UPDATE notification_outbox
    SET failed_rounds = ?, next_attempt_at = ?, last_error = ?
    WHERE id = ?`;
  try {
    await conn.run(sql, [failedRounds, toTs(nextAttemptAt), error, id]);
    return { ok: true, value: undefined };
  } catch (err) {
    log.error("Error marking notification %s failed: %s", id, err);
    return { ok: false, error: toError(err) };
  }
}

/** Deletes finished (delivered or dropped) notifications older than `before`. */
export async function pruneNotifications(
  conn: DuckDBConnection,
  log: Logger,
  chainId: string,
  before: Date,
): Promise<Result<void, Error>> {
  const sql = `DELETE FROM notification_outbox WHERE chain_id = ? AND delivered_at < ?`;
  try {
    await conn.run(sql, [chainId, toTs(before)]);
    return { ok: true, value: undefined };
  } catch (error) {
    log.error("Error pruning notifications for %s: %s", chainId, error);
    return { ok: false, error: toError(error) };
  }
}
