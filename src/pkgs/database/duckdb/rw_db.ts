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
import type { BlockWindowStats, ChainSignatureStats } from "../analytics";
import type { IWriteDb } from "../interfaces";
import { generateCreateTableStatements } from "../sql/generate";
import type { Constructor } from "../sql/types";
import { Alert, Block } from "../tables";
import {
  alertToRow,
  blockToRow,
  rowToAlert,
  rowToBlock,
  rowToBlockWindowStats,
  rowToSignStats,
} from "./mappers";
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

  private static readonly APPENDER_CHUNK_ROWS = 2048;

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

  // initSchema initialises the database schema
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

  /**
   * appendBlocks appends an array of blocks to the database
   * @param chainId unique chain identification
   * @param blocks array of blocks to append
   * @returns promise wrapped result of the append
   */
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
      // A DuckDBDataChunk is capped at DuckDB's internal STANDARD_VECTOR_SIZE (2048 rows)
      // Split larger batches across multiple chunks on the same appender.
      for (let i = 0; i < duckdbData.length; i += RWDB.APPENDER_CHUNK_ROWS) {
        const slice = duckdbData.slice(i, i + RWDB.APPENDER_CHUNK_ROWS);
        const chunk = DuckDBDataChunk.create([VARCHAR, UBIGINT, BLOB, TIMESTAMP, TINYINT, BLOB]);
        chunk.setRows(
          slice.map((data) => [
            data.chainId,
            data.height,
            data.hash,
            data.time,
            data.signed,
            data.signature ?? null,
          ]),
        );
        appender.appendDataChunk(chunk);
      }
      appender.closeSync();
      this.log.info("Blocks appended successfully");
      return { ok: true, value: undefined };
    } catch (error) {
      this.log.error("Error appending blocks: %s", error);
      return { ok: false, error: toError(error) };
    }
  }

  /**
   * insertBlocks inserts an array of blocks into the database
   * @param chainId unique chain identification
   * @param blocks array of blocks to insert
   * @returns promise wrapped result of the insert
   */
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

  /**
   * latestBlock returns the latest block for the given chain
   * @param chainId unique chain identification
   * @param chainType the type of chain to get blocks for
   * @returns promise wrapped result of the latest block
   */
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

  /**
   * latestBlockHeight returns the latest block height for the given chain
   * @param chainId unique chain identification
   * @returns promise wrapped result of the latest block height
   */
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

  /**
   * insertAlert inserts an alert into the database
   * @param alert data containing all alert information
   * @returns promise wrapped result of the insert
   */
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

  /**
   * touchAlertNotified updates the last notified at date and repeat count for the alert
   * @param alertId unique alert id
   * @param notifiedAt notified at date
   * @param repeatCount repeat count
   * @returns a promise wrapped result of the update
   */
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

  /**
   * getChainSignedPercentage returns a promise wrapped result of the chain's signed percentage
   * @param chainId a unique id for the chain
   * @param days an integer number of days to look back
   * @returns a promise wrapped result of the chain's signed percentage
   */
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

  /**
   * getBlockByHeight returns a promise wrapped result of the block at the given height
   * @param chainId id specific to that chain
   * @param height a height to get the block for
   * @param chainType the type of chain to get blocks for
   * @returns a promise wrapped result of the block at the given height
   */
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

  /**
   * getBlockByRange returns a promise wrapped result of the blocks in the range
   * @param chainId a id that is unique to that chain
   * @param startHeight a height to start the range from
   * @param endHeight a height to end the range at
   * @param chainType the type of chain to get blocks for
   * @returns a promise wrapped result of the blocks in the range
   */
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

  /**
   * Aggregate total/missed counts over a height range.
   * Used for percentageMissedBlocksAlert so a wide signing window never needs every row pulled
   * across the wire, just two counts.
   * @param chainId the chain ID to query
   * @param startHeight the start height of the range
   * @param endHeight the end height of the range
   * @returns a result containing the aggregated stats or an error
   */
  public async getBlockStats(
    chainId: string,
    startHeight: bigint,
    endHeight: bigint,
  ): Promise<Result<BlockWindowStats, Error>> {
    const sql = `
      SELECT
        count(*) FILTER (WHERE signed != -1) as total,
        count(*) FILTER (WHERE signed = 0) as missed
      FROM blocks
      WHERE chain_id = ? AND height >= ? AND height <= ?`;
    try {
      const result = await this.conn.run(sql, [chainId, startHeight, endHeight]);
      const rows = await result.getRowObjects();
      return { ok: true, value: rowToBlockWindowStats(rows[0] ?? { total: 0, missed: 0 }) };
    } catch (error) {
      this.log.error("Error getting block stats: %s", error);
      return { ok: false, error: toError(error) };
    }
  }
}
