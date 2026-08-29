import { existsSync, mkdirSync } from "node:fs";
import { type DuckDBConnection, DuckDBInstance } from "@duckdb/node-api";
import type { Logger } from "pino";
import logger from "../../logger";
import type { Result } from "../../models/result";
import type { BlockWindowStats, ChainSignatureStats, DailyBlockStats } from "../analytics";
import type { IWriteDb } from "../interfaces";
import { generateCreateTableStatements } from "../sql/generate";
import type { Constructor } from "../sql/types";
import { Alert, Block } from "../tables";
import * as alertQueries from "./queries/alerts";
import * as blockQueries from "./queries/blocks";
import { ChainScopedDb } from "./scoped";

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

  public appendBlocks(chainId: string, blocks: Block[]): Promise<Result<undefined, Error>> {
    return blockQueries.appendBlocks(this.conn, this.log, chainId, blocks);
  }

  public insertBlocks(chainId: string, blocks: Block[]): Promise<Result<void, Error>> {
    return blockQueries.insertBlocks(this.conn, this.log, chainId, blocks);
  }

  public latestBlock(
    chainId: string,
    chainType: "bft" | "tm2",
  ): Promise<Result<Block | null, Error>> {
    return blockQueries.latestBlock(this.conn, this.log, chainId, chainType);
  }

  public latestBlockHeight(chainId: string): Promise<Result<bigint | null, Error>> {
    return blockQueries.latestBlockHeight(this.conn, this.log, chainId);
  }

  public insertAlert(alert: Alert): Promise<Result<void, Error>> {
    return alertQueries.insertAlert(this.conn, this.log, alert);
  }

  public getAlert(alertKey: string): Promise<Result<Alert | null, Error>> {
    return alertQueries.getAlert(this.conn, this.log, alertKey);
  }

  public getUnclosedAlerts(chainId: string): Promise<Result<Alert[], Error>> {
    return alertQueries.getUnclosedAlerts(this.conn, this.log, chainId);
  }

  public closeAlert(alertId: string, closedAt: Date): Promise<Result<void, Error>> {
    return alertQueries.closeAlert(this.conn, this.log, alertId, closedAt);
  }

  public touchAlertNotified(
    alertId: string,
    notifiedAt: Date,
    repeatCount: number,
  ): Promise<Result<void, Error>> {
    return alertQueries.touchAlertNotified(this.conn, this.log, alertId, notifiedAt, repeatCount);
  }

  public getChainSignedPercentage(
    chainId: string,
    days: number,
  ): Promise<Result<ChainSignatureStats | null, Error>> {
    return blockQueries.getChainSignedPercentage(this.conn, this.log, chainId, days);
  }

  public getBlockByHeight(
    chainId: string,
    height: bigint,
    chainType: "bft" | "tm2",
  ): Promise<Result<Block | null, Error>> {
    return blockQueries.getBlockByHeight(this.conn, this.log, chainId, height, chainType);
  }

  public getBlockByRange(
    chainId: string,
    startHeight: bigint,
    endHeight: bigint,
    chainType: "bft" | "tm2",
  ): Promise<Result<Block[], Error>> {
    return blockQueries.getBlockByRange(
      this.conn,
      this.log,
      chainId,
      startHeight,
      endHeight,
      chainType,
    );
  }

  public getBlockStats(
    chainId: string,
    startHeight: bigint,
    endHeight: bigint,
  ): Promise<Result<BlockWindowStats, Error>> {
    return blockQueries.getBlockStats(this.conn, this.log, chainId, startHeight, endHeight);
  }

  public getDailySignedStats(
    chainId: string,
    days: number,
  ): Promise<Result<DailyBlockStats[], Error>> {
    return blockQueries.getDailySignedStats(this.conn, this.log, chainId, days);
  }
}
