import { type DuckDBConnection, DuckDBInstance } from "@duckdb/node-api";
import type { Logger } from "pino";
import logger from "../logger/logger";
import { Alert, Block } from "./tables";

export interface RodbQueryResult<T> {
  success: boolean;
  error?: string;
  result?: T;
}

/**
 * Read-only DuckDB connection intended for API use. This instance opens the database
 * in READ_ONLY mode, meaning it can safely run alongside the RWDB writer without
 * risking concurrent write conflicts.
 */
export class RODB {
  chainId: string;
  conn: DuckDBConnection;
  log: Logger;

  private constructor(chainId: string, conn: DuckDBConnection) {
    this.chainId = chainId;
    this.conn = conn;
    this.log = logger.child({ module: `RODB${chainId}` });
  }

  /**
   * Create a read-only DuckDB instance. The access_mode is always READ_ONLY and
   * cannot be overridden via options.
   * @param dbDir Directory where all of the databases are located.
   * @param chainId Chain identifier which is usually tied to the blockchain.
   * @param options Additional DuckDB options. See https://duckdb.org/docs/current/configuration/overview.
   * @returns A RODB instance.
   */
  public static async create(
    dbDir: string,
    chainId: string,
    options?: Record<string, string>,
  ): Promise<RODB> {
    const defaultOptions: Record<string, string> = {
      threads: "1",
      memory_limit: "250MB",
      access_mode: "READ_ONLY",
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

    const rodb = new RODB(chainId, conn);
    rodb.log.info("Read-only database connection established successfully");
    rodb.log.debug("Database options: %o", defaultOptions);
    return rodb;
  }

  public close() {
    this.conn.closeSync();
    this.log.debug("Read-only database connection closed successfully");
  }

  /**
   * Get the latest block from the database.
   * @returns The latest block or null if no blocks are found.
   */
  public async latestBlock(): Promise<RodbQueryResult<Block | null>> {
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
  public async latestBlockHeight(): Promise<RodbQueryResult<bigint | null>> {
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
   * Get an alert by its dedup key (alertId). The key is generated via
   * `Alert.generateKey(chainId, alertType)`.
   * @param alertKey The SHA-256 dedup key to look up.
   */
  public async getAlert(alertKey: string): Promise<RodbQueryResult<Alert | null>> {
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
   * @returns All open alerts ordered by oldest first.
   */
  public async getUnclosedAlerts(): Promise<RodbQueryResult<Alert[]>> {
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
