import { existsSync, mkdirSync } from "node:fs";
import {
  BLOB,
  BOOLEAN,
  type DuckDBConnection,
  DuckDBDataChunk,
  DuckDBInstance,
  TIMESTAMP,
  UBIGINT,
} from "@duckdb/node-api";
import type { Logger } from "pino";
import logger from "../logger";
import { generateCreateTableStatements } from "./sql/generate";
import type { Constructor } from "./sql/types";
import { Alert, Block } from "./tables";

export interface RwdbWriteResult {
  success: boolean;
  error?: string;
}

export interface RwdbQueryResult<T> {
  success: boolean;
  error?: string;
  result?: T;
}

export class RWDB {
  chainId: string;
  conn: DuckDBConnection;
  log: Logger;

  private constructor(chainId: string, conn: DuckDBConnection) {
    this.chainId = chainId;
    this.conn = conn;
    this.log = logger.child({ module: `RWDB${chainId}` });
  }

  /**
   * Create a read-write duck database instance that provides means to interact with the database.
   * @param dbDir Directory where all of the databases are located.
   * @param chainId Chain identifier which is usually tied to the blockchain.
   * @param options Options for duckdb. Check the https://duckdb.org/docs/current/configuration/overview for
   * more information. Any of the settings you want to apply just make Record and insert any parameter like that.
   * @returns A RWDB Class instance.
   */
  public static async create(
    dbDir: string,
    chainId: string,
    options?: Record<string, string>,
  ): Promise<RWDB> {
    const chainDir = `${dbDir}/${chainId}`;
    const tempDir = `${chainDir}/temp/`;
    if (!existsSync(tempDir)) {
      mkdirSync(tempDir, { recursive: true });
    }

    const defaultOptions: Record<string, string> = {
      threads: "2",
      memory_limit: "500MB",
      temp_directory: tempDir,
      access_mode: "READ_WRITE",
      max_temp_directory_size: "1GB",
    };
    if (options) {
      for (const [key, value] of Object.entries(options)) {
        if (key === "access_mode") {
          // There should never be an option to overwrite this! If the script does see this it will skip it over.
          continue;
        }
        defaultOptions[key] = value;
      }
    }

    const conn = await DuckDBInstance.create(`${dbDir}/${chainId}.duckdb`, defaultOptions).then(
      (instance) => instance.connect(),
    );

    const rwdb = new RWDB(chainId, conn);
    rwdb.log.info("Database connection established successfully");
    rwdb.log.debug("Database options: %o", defaultOptions);
    await rwdb.initSchema();
    return rwdb;
  }

  /**
   * Run CREATE TABLE IF NOT EXISTS (and any index DDL) for every known table.
   * Safe to call on every startup — all statements are idempotent.
   */
  private async initSchema(): Promise<void> {
    const tables: Constructor[] = [Block, Alert] as unknown as Constructor[];
    for (const table of tables) {
      for (const stmt of generateCreateTableStatements(table)) {
        await this.conn.run(stmt);
      }
    }
    this.log.info("Schema initialised");
  }

  // Close the database connection.
  public close() {
    this.conn.closeSync();
    this.log.debug("Database connection closed successfully");
  }

  /**
   * Insert blocks into duckdb using it's appended. Use case for this is usually when there are multiple
   * blocks to insert at once.
   * @param blocks Blocks to append to the database.
   */
  public async appendBlocks(blocks: Block[]): Promise<RwdbWriteResult> {
    // Init the appender
    this.log.debug("Appending %d blocks to the database", blocks.length);
    this.log.info(
      "Inserting from %s to %s",
      blocks[0]?.height.toString(),
      blocks[blocks.length - 1]?.height.toString(),
    );
    const duckdbData = blocks.map((block) => block.toDuckDbData());
    try {
      const appender = await this.conn.createAppender("blocks");
      const chunk = DuckDBDataChunk.create([UBIGINT, BLOB, TIMESTAMP, BOOLEAN, BLOB]);
      chunk.setRows(
        duckdbData.map((data) => [
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
      return { success: true };
    } catch (error) {
      this.log.error("Error appending blocks: %s", error);
      return { success: false, error: error as string };
    }
  }

  /**
   * Insert multiple blocks into the duckdb. Useful for smaller group of blocks to insert at once. If there
   * are large amount of blocks to insert use appendBlocks instead.
   * @param blocks Blocks to insert into the database.
   */
  public async insertBlocks(blocks: Block[]): Promise<RwdbWriteResult> {
    this.log.debug("Inserting %d blocks into the database", blocks.length);
    this.log.info(
      "Inserting from %s to %s",
      blocks[0]?.height.toString(),
      blocks[blocks.length - 1]?.height.toString(),
    );
    const duckdbData = blocks.map((block) => block.toDuckDbData());
    const sql = `
    INSERT INTO ${blocks[0]?.getTableName}
    VALUES ${duckdbData.map((data) => `(${data.height}, ${data.hash}, ${data.time}, ${data.signed}, ${data.signature ?? null})`).join(", ")}`;
    try {
      const result = await this.conn.run(sql);
      this.log.debug("Insert result: %o", result);
      this.log.info("Blocks inserted successfully");
      return { success: true };
    } catch (error) {
      this.log.error("Error inserting blocks: %s", error);
      return { success: false, error: error as string };
    }
  }

  /**
   * Get the latest block from the database.
   * @returns The latest block or null if no blocks are found.
   */
  public async latestBlock(): Promise<RwdbQueryResult<Block | null>> {
    const sql = `SELECT * FROM blocks ORDER BY height DESC LIMIT 1`;
    try {
      const result = await this.conn.runAndReadAll(sql);
      const rows = result.getRowObjects();
      if (rows.length === 0) {
        return { success: true, result: null };
      }
      return { success: true, result: Block.fromDuckDbData(rows[0]) };
    } catch (error) {
      this.log.error("Error getting latest block: %s", error);
      return { success: false, error: error as string };
    }
  }

  /**
   * Get the height of the latest block from the database.
   * @returns The height of the latest block or null if no blocks are found.
   */
  public async latestBlockHeight(): Promise<RwdbQueryResult<bigint | null>> {
    const sql = `SELECT height FROM blocks ORDER BY height DESC LIMIT 1`;
    try {
      const result = await this.conn.runAndReadAll(sql);
      const rows = result.getRows();
      if (rows.length === 0) {
        return { success: true, result: null };
      }
      return { success: true, result: rows[0][0] as bigint };
    } catch (error) {
      this.log.error("Error getting latest block height: %s", error);
      return { success: false, error: error as string };
    }
  }

  /**
   * Insert an alert into the database. The alert's `alertId` should be generated via
   * `Alert.generateKey(chainId, alertType)` so it can be deterministically recreated
   * and used as a PagerDuty dedup_key to open or resolve incidents.
   * @param alert Alert to insert.
   */
  public async insertAlert(alert: Alert): Promise<RwdbWriteResult> {
    this.log.debug("Inserting alert %s into the database", alert.alertId);
    const openedAt = alert.openedAt.toISOString().replace("T", " ").replace("Z", "");
    const closedAt =
      alert.closedAt != null
        ? `'${alert.closedAt.toISOString().replace("T", " ").replace("Z", "")}'`
        : "NULL";
    const sql = `
      INSERT INTO alerts (alert_id, chain_id, alert_type, opened_at, closed_at)
      VALUES (
        '${alert.alertId}',
        '${alert.chainId}',
        '${alert.alertType}',
        '${openedAt}',
        ${closedAt}
      )
    `;
    try {
      await this.conn.run(sql);
      this.log.info("Alert %s inserted successfully", alert.alertId);
      return { success: true };
    } catch (error) {
      this.log.error("Error inserting alert %s: %s", alert.alertId, error);
      return { success: false, error: error as string };
    }
  }

  /**
   * Get an alert by its dedup key (alertId). The key is generated via
   * `Alert.generateKey(chainId, alertType)`.
   * @param alertKey The SHA-256 dedup key to look up.
   */
  public async getAlert(alertKey: string): Promise<RwdbQueryResult<Alert | null>> {
    const sql = `SELECT * FROM alerts WHERE alert_id = '${alertKey}' LIMIT 1`;
    try {
      const result = await this.conn.runAndReadAll(sql);
      const rows = result.getRowObjects();
      if (rows.length === 0) {
        return { success: true, result: null };
      }
      return { success: true, result: Alert.fromDuckDbData(rows[0]) };
    } catch (error) {
      this.log.error("Error getting alert %s: %s", alertKey, error);
      return { success: false, error: error as string };
    }
  }

  /**
   * Get all alerts that have not yet been closed (closed_at IS NULL).
   * Use this to find open incidents that need to be resolved in PagerDuty.
   */
  public async getUnclosedAlerts(): Promise<RwdbQueryResult<Alert[]>> {
    const sql = `SELECT * FROM alerts WHERE closed_at IS NULL ORDER BY opened_at ASC`;
    try {
      const result = await this.conn.runAndReadAll(sql);
      const rows = result.getRowObjects();
      return { success: true, result: rows.map((row) => Alert.fromDuckDbData(row)) };
    } catch (error) {
      this.log.error("Error getting unclosed alerts: %s", error);
      return { success: false, error: error as string };
    }
  }
}
