import { type DuckDBConnection, DuckDBInstance } from "@duckdb/node-api";
import type { Logger } from "pino";
import logger from "../../logger";
import type { DbQueryResult, IReadDb } from "../interfaces";
import { Alert, Block } from "../tables";

export class RODB implements IReadDb {
  chainId: string;
  conn: DuckDBConnection;
  log: Logger;

  private constructor(chainId: string, conn: DuckDBConnection) {
    this.chainId = chainId;
    this.conn = conn;
    this.log = logger.child({ module: `RODB${chainId}` });
  }

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
