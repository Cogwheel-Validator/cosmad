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
import logger from "../../logger";
import type { DbQueryResult, DbWriteResult, IWriteDb } from "../interfaces";
import { generateCreateTableStatements } from "../sql/generate";
import type { Constructor } from "../sql/types";
import { Alert, Block } from "../tables";

export class RWDB implements IWriteDb {
  chainId: string;
  conn: DuckDBConnection;
  log: Logger;

  private constructor(chainId: string, conn: DuckDBConnection) {
    this.chainId = chainId;
    this.conn = conn;
    this.log = logger.child({ module: `RWDB${chainId}` });
  }

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

  public async appendBlocks(blocks: Block[]): Promise<DbWriteResult> {
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

  public async insertBlocks(blocks: Block[]): Promise<DbWriteResult> {
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

  public async latestBlock(): Promise<DbQueryResult<Block | null>> {
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

  public async latestBlockHeight(): Promise<DbQueryResult<bigint | null>> {
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

  public async insertAlert(alert: Alert): Promise<DbWriteResult> {
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

  public async getAlert(alertKey: string): Promise<DbQueryResult<Alert | null>> {
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

  public async getUnclosedAlerts(): Promise<DbQueryResult<Alert[]>> {
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
