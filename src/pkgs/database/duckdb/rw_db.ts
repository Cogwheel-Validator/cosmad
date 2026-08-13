import { existsSync, mkdirSync } from "node:fs";
import {
  BLOB,
  type DuckDBConnection,
  DuckDBDataChunk,
  DuckDBInstance,
  DuckDBTimestampValue,
  TIMESTAMP,
  TINYINT,
  UBIGINT,
  VARCHAR,
} from "@duckdb/node-api";
import type { Logger } from "pino";
import logger from "../../logger";
import type { Result } from "../../models/result";
import type { ChainSignatureStats } from "../analytics";
import type { IWriteDb } from "../interfaces";
import { generateCreateTableStatements } from "../sql/generate";
import type { Constructor } from "../sql/types";
import { Alert, Block } from "../tables";
import { alertToRow, blockToRow, rowToAlert, rowToBlock, rowToSignStats } from "./mappers";
import { ChainScopedDb } from "./scoped";

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export interface DuckDbOptions {
  threads: string;
  memoryLimit: string;
  maxTempDirectorySize?: string;
}

// A duckdb instance that can read and write data.
export class RWDB {
  conn: DuckDBConnection;
  log: Logger;

  // Private constructor, use create() instead.
  private constructor(conn: DuckDBConnection) {
    this.conn = conn;
    this.log = logger.child({ module: "RWDB" });
  }

  /**
   * Creates the shared RWDB, using the specified database directory.
   * @param dbDir path to the directory where the database file will be stored
   * @returns a new RWDB instance
   */
  public static async create(dbDir: string, options: DuckDbOptions): Promise<RWDB> {
    const tempDir = `${dbDir}/temp/`;
    if (!existsSync(tempDir)) {
      mkdirSync(tempDir, { recursive: true });
    }

    const dbOptions: Record<string, string> = {
      threads: options.threads,
      memory_limit: options.memoryLimit,
      temp_directory: tempDir,
      access_mode: "READ_WRITE",
      max_temp_directory_size: options.maxTempDirectorySize ?? "4GB",
    };

    const instance = await DuckDBInstance.create(`${dbDir}/cosmad.duckdb`, dbOptions);
    const conn = await instance.connect();

    const rwdb = new RWDB(conn);
    rwdb.log.info("Database connection established successfully");
    await rwdb.initSchema();
    return rwdb;
  }

  private async initSchema(): Promise<void> {
    const tables: Constructor[] = [Block, Alert] as unknown as Constructor[];
    for (const table of tables) {
      for (const stmt of generateCreateTableStatements(table)) {
        await this.conn.run(stmt);
      }
    }
    this.log.info("Schema initialised");
  }

  public close() {
    this.conn.closeSync();
    this.log.debug("Database connection closed successfully");
  }

  /** A view over this shared RWDB scoped to one chain, for in-process callers that want IWriteDb. */
  public forChain(chainId: string, chainType: "bft" | "tm2"): IWriteDb {
    return new ChainScopedDb(this, chainId, chainType);
  }

  public async appendBlocks(chainId: string, blocks: Block[]): Promise<Result<undefined, Error>> {
    this.log.debug("Appending %d blocks for %s to the database", blocks.length, chainId);
    this.log.info(
      "Inserting from %s to %s",
      blocks[0]?.height.toString(),
      blocks[blocks.length - 1]?.height.toString(),
    );
    const duckdbData = blocks.map((block) => blockToRow(block));
    try {
      const appender = await this.conn.createAppender("blocks");
      const chunk = DuckDBDataChunk.create([VARCHAR, UBIGINT, BLOB, TIMESTAMP, TINYINT, BLOB]);
      chunk.setRows(
        duckdbData.map((data) => [
          data.chainId,
          data.height,
          data.hash,
          data.time,
          data.signed,
          data.signature ?? null,
        ]),
      );
      appender.appendDataChunk(chunk);
      appender.closeSync();
      this.log.info("Blocks appended successfully");
      return { ok: true, value: undefined };
    } catch (error) {
      this.log.error("Error appending blocks: %s", error);
      return { ok: false, error: toError(error) };
    }
  }

  public async insertBlocks(chainId: string, blocks: Block[]): Promise<Result<void, Error>> {
    this.log.debug("Inserting %d blocks for %s into the database", blocks.length, chainId);
    this.log.info(
      "Inserting from %s to %s",
      blocks[0]?.height.toString(),
      blocks[blocks.length - 1]?.height.toString(),
    );
    const duckdbData = blocks.map((block) => blockToRow(block));
    const placeholders = duckdbData.map(() => "(?, ?, ?, ?, ?, ?)").join(", ");
    const sql = `INSERT INTO blocks VALUES ${placeholders}`;
    const values = duckdbData.flatMap((data) => [
      data.chainId,
      data.height,
      data.hash,
      data.time,
      data.signed,
      data.signature ?? null,
    ]);
    try {
      const result = await this.conn.run(sql, values);
      this.log.debug("Insert result: %o", result);
      this.log.info("Blocks inserted successfully");
      return { ok: true, value: undefined };
    } catch (error) {
      this.log.error("Error inserting blocks: %s", error);
      return { ok: false, error: toError(error) };
    }
  }

  public async latestBlock(
    chainId: string,
    chainType: "bft" | "tm2",
  ): Promise<Result<Block | null, Error>> {
    const sql = `
      SELECT
        chain_id,
        height,
        hash,
        time,
        signed,
        signature
      FROM blocks
      WHERE chain_id = ?
      ORDER BY height DESC LIMIT 1`;
    try {
      const result = await this.conn.runAndReadAll(sql, [chainId]);
      const row = result.getRowObjects(); // only 1 row
      if (row.length === 0) return { ok: true, value: null };
      return { ok: true, value: rowToBlock(row[0], chainType) };
    } catch (error) {
      this.log.error("Error getting latest block: %s", error);
      return { ok: false, error: toError(error) };
    }
  }

  public async latestBlockHeight(chainId: string): Promise<Result<bigint | null, Error>> {
    const sql = `SELECT height FROM blocks WHERE chain_id = ? ORDER BY height DESC LIMIT 1`;
    try {
      const result = await this.conn.runAndReadAll(sql, [chainId]);
      const rows = result.getRows();
      if (rows.length === 0) {
        return { ok: true, value: null };
      }
      return { ok: true, value: rows[0][0] as bigint };
    } catch (error) {
      this.log.error("Error getting latest block height: %s", error);
      return { ok: false, error: toError(error) };
    }
  }

  public async insertAlert(alert: Alert): Promise<Result<void, Error>> {
    this.log.debug("Inserting alert %s into the database", alert.alertId);
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
      await this.conn.run(sql, values);
      this.log.info("Alert %s inserted successfully", alert.alertId);
      return { ok: true, value: undefined };
    } catch (error) {
      this.log.error("Error inserting alert %s: %s", alert.alertId, error);
      return { ok: false, error: toError(error) };
    }
  }

  public async getAlert(alertKey: string): Promise<Result<Alert | null, Error>> {
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
      const result = await this.conn.runAndReadAll(sql, [alertKey]);
      const rows = result.getRowObjects();
      if (rows.length === 0) {
        return { ok: true, value: null };
      }
      return { ok: true, value: rowToAlert(rows[0]) };
    } catch (error) {
      this.log.error("Error getting alert %s: %s", alertKey, error);
      return { ok: false, error: toError(error) };
    }
  }

  public async getUnclosedAlerts(chainId: string): Promise<Result<Alert[], Error>> {
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
      ORDER BY opened_at ASC`;
    try {
      const result = await this.conn.runAndReadAll(sql, [chainId]);
      const rows = result.getRowObjects();
      return { ok: true, value: rows.map((row) => rowToAlert(row)) };
    } catch (error) {
      this.log.error("Error getting unclosed alerts: %s", error);
      return { ok: false, error: toError(error) };
    }
  }

  public async closeAlert(alertId: string, closedAt: Date): Promise<Result<void, Error>> {
    const ts = new DuckDBTimestampValue(BigInt(closedAt.getTime()) * 1000n);
    const sql = `UPDATE alerts SET closed_at = ? WHERE alert_id = ?`;
    try {
      await this.conn.run(sql, [ts, alertId]);
      this.log.info("Alert %s closed at %s", alertId, closedAt.toISOString());
      return { ok: true, value: undefined };
    } catch (error) {
      this.log.error("Error closing alert %s: %s", alertId, error);
      return { ok: false, error: toError(error) };
    }
  }

  public async touchAlertNotified(
    alertId: string,
    notifiedAt: Date,
    repeatCount: number,
  ): Promise<Result<void, Error>> {
    const ts = new DuckDBTimestampValue(BigInt(notifiedAt.getTime()) * 1000n);
    const sql = `UPDATE alerts SET last_notified_at = ?, repeat_count = ? WHERE alert_id = ?`;
    try {
      await this.conn.run(sql, [ts, repeatCount, alertId]);
      this.log.debug("Alert %s marked notified (repeatCount=%d)", alertId, repeatCount);
      return { ok: true, value: undefined };
    } catch (error) {
      this.log.error("Error touching alert %s: %s", alertId, error);
      return { ok: false, error: toError(error) };
    }
  }

  public async getChainSignedPercentage(
    chainId: string,
    days: number,
  ): Promise<Result<ChainSignatureStats | null, Error>> {
    const sql = `
      WITH current_time AS (
        SELECT current_timestamp() as now
      ),
      missed AS (
        SELECT count() * 1.0 as missed
        FROM blocks
        CROSS JOIN current_time
        WHERE chain_id = ? AND time >= current_time.now - INTERVAL '? days' AND time <= current_time.now
      ),
      total AS (
        SELECT count() * 1.0 as total
        FROM blocks
        CROSS JOIN current_time
        WHERE chain_id = ? AND time >= current_time.now - INTERVAL '? days' AND time <= current_time.now
      )
      SELECT
        (t.total - m.missed) / t.total as signed,
        m.missed / t.total as missed
      FROM total t
      CROSS JOIN missed m`;
    try {
      const result = await this.conn.run(sql, [chainId, days, chainId, days]);
      const row = await result.getRowObjects(); // only one row
      if (row.length === 0) return { ok: true, value: null };
      return { ok: true, value: rowToSignStats(row[0]) };
    } catch (error) {
      this.log.error("Error getting chain signed percentage: %s", error);
      return { ok: false, error: toError(error) };
    }
  }

  public async getBlockByHeight(
    chainId: string,
    height: bigint,
    chainType: "bft" | "tm2",
  ): Promise<Result<Block | null, Error>> {
    const sql = `
      SELECT
        chain_id,
        height,
        hash,
        time,
        signed,
        signature
      FROM blocks
      WHERE
        chain_id = ? AND height = ?`;
    try {
      const result = await this.conn.run(sql, [chainId, height]);
      const row = await result.getRowObjects(); // only one row
      if (row.length === 0) return { ok: true, value: null };
      return { ok: true, value: rowToBlock(row[0], chainType) };
    } catch (error) {
      this.log.error("Error getting block by height: %s", error);
      return { ok: false, error: toError(error) };
    }
  }

  public async getBlockByRange(
    chainId: string,
    startHeight: bigint,
    endHeight: bigint,
    chainType: "bft" | "tm2",
  ): Promise<Result<Block[], Error>> {
    const sql = `
      SELECT
        chain_id,
        height,
        hash,
        time,
        signed,
        signature
      FROM blocks
      WHERE
        chain_id = ? AND height >= ? AND height <= ?`;
    try {
      const result = await this.conn.run(sql, [chainId, startHeight, endHeight]);
      const rows = await result.getRowObjects();
      return { ok: true, value: rows.map((row) => rowToBlock(row, chainType)) };
    } catch (error) {
      this.log.error("Error getting block by range: %s", error);
      return { ok: false, error: toError(error) };
    }
  }
}
