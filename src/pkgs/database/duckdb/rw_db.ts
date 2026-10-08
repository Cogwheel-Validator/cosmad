import { existsSync, mkdirSync } from "node:fs";
import { type DuckDBConnection, DuckDBInstance } from "@duckdb/node-api";
import type { Logger } from "pino";
import logger from "../../logger";
import type { Result } from "../../models/result";
import type { BlockWindowStats, ChainSignatureStats, DailyBlockStats } from "../analytics";
import type { IWriteDb } from "../interfaces";
import { generateCreateTableStatements } from "../sql/generate";
import type { Constructor } from "../sql/types";
import { Alert, Block, ValidatorInactivity } from "../tables";
import * as alertQueries from "./queries/alerts";
import * as blockQueries from "./queries/blocks";
import * as inactivityQueries from "./queries/inactivity";
import { ChainScopedDb } from "./scoped";

export interface DuckDbOptions {
  threads: string;
  memoryLimit: string;
  maxTempDirectorySize?: string;
}

// Number of dedicated read connections, round-robined across for every read-only query.
const READER_POOL_SIZE = 10;

// A duckdb instance that can read and write data.
export class RWDB {
  instance: DuckDBInstance;
  conn: DuckDBConnection;
  log: Logger;
  private readConns: DuckDBConnection[];
  private nextReadConnIdx = 0;

  // Private constructor, use create() instead.
  private constructor(
    instance: DuckDBInstance,
    conn: DuckDBConnection,
    readConns: DuckDBConnection[],
  ) {
    this.instance = instance;
    this.conn = conn;
    this.readConns = readConns;
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

    const log = logger.child({ module: "RWDB" });
    log.info("Opening database at %s (may take a while if replaying WAL entries)", dbDir);
    const openStartedAt = Date.now();
    const instance = await DuckDBInstance.create(`${dbDir}/cosmad.duckdb`, dbOptions);
    const conn = await instance.connect();
    const readConns = await Promise.all(
      Array.from({ length: READER_POOL_SIZE }, () => instance.connect()),
    );
    log.info("Database opened in %dms", Date.now() - openStartedAt);

    const rwdb = new RWDB(instance, conn, readConns);
    rwdb.log.info("Database connection established successfully");
    await rwdb.initSchema();
    return rwdb;
  }

  // initSchema initialises the database schema
  private async initSchema(): Promise<void> {
    const tables: Constructor[] = [Block, Alert, ValidatorInactivity] as unknown as Constructor[];
    for (const table of tables) {
      for (const stmt of generateCreateTableStatements(table)) {
        await this.conn.run(stmt);
      }
    }
    this.log.info("Schema initialised");
  }

  /** Round-robins across the reader pool - call once per read-only query issued. */
  private nextReadConn = (): DuckDBConnection => {
    const conn = this.readConns[this.nextReadConnIdx];
    this.nextReadConnIdx = (this.nextReadConnIdx + 1) % this.readConns.length;
    // biome-ignore lint/style/noNonNullAssertion: <nextReadConnIdx is always < readConns.length>
    return conn!;
  };

  public close() {
    this.conn.closeSync();
    for (const conn of this.readConns) conn.closeSync();
    this.instance.closeSync();
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
    return blockQueries.latestBlock(this.nextReadConn(), this.log, chainId, chainType);
  }

  public latestBlockHeight(chainId: string): Promise<Result<bigint | null, Error>> {
    return blockQueries.latestBlockHeight(this.nextReadConn(), this.log, chainId);
  }

  public insertAlert(alert: Alert): Promise<Result<void, Error>> {
    return alertQueries.insertAlert(this.conn, this.log, alert);
  }

  public getAlert(alertKey: string): Promise<Result<Alert | null, Error>> {
    return alertQueries.getAlert(this.nextReadConn(), this.log, alertKey);
  }

  public getUnclosedAlerts(
    chainId: string,
    limit: number,
    page: number,
  ): Promise<Result<Alert[], Error>> {
    return alertQueries.getUnclosedAlerts(this.nextReadConn(), this.log, chainId, limit, page);
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

  public insertInactivity(period: ValidatorInactivity): Promise<Result<void, Error>> {
    return inactivityQueries.insertInactivity(this.conn, this.log, period);
  }

  public endInactivity(
    chainId: string,
    startHeight: bigint,
    endHeight: bigint,
    endTime: Date,
  ): Promise<Result<void, Error>> {
    return inactivityQueries.endInactivity(
      this.conn,
      this.log,
      chainId,
      startHeight,
      endHeight,
      endTime,
    );
  }

  public getOpenInactivity(chainId: string): Promise<Result<ValidatorInactivity | null, Error>> {
    return inactivityQueries.getOpenInactivity(this.nextReadConn(), this.log, chainId);
  }

  public getInactivityHistory(
    chainId: string,
    limit: number,
  ): Promise<Result<ValidatorInactivity[], Error>> {
    return inactivityQueries.getInactivityHistory(this.nextReadConn(), this.log, chainId, limit);
  }

  public getChainSignedPercentage(
    chainId: string,
    days: number,
  ): Promise<Result<ChainSignatureStats | null, Error>> {
    return blockQueries.getChainSignedPercentage(this.nextReadConn(), this.log, chainId, days);
  }

  public getBlockByHeight(
    chainId: string,
    height: bigint,
    chainType: "bft" | "tm2",
  ): Promise<Result<Block | null, Error>> {
    return blockQueries.getBlockByHeight(this.nextReadConn(), this.log, chainId, height, chainType);
  }

  public getBlockByRange(
    chainId: string,
    startHeight: bigint,
    endHeight: bigint,
    chainType: "bft" | "tm2",
  ): Promise<Result<Block[], Error>> {
    return blockQueries.getBlockByRange(
      this.nextReadConn(),
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
    return blockQueries.getBlockStats(
      this.nextReadConn(),
      this.log,
      chainId,
      startHeight,
      endHeight,
    );
  }

  public getDailySignedStats(
    chainId: string,
    days: number,
  ): Promise<Result<DailyBlockStats[], Error>> {
    return blockQueries.getDailySignedStats(this.nextReadConn(), this.log, chainId, days);
  }

  public getDailySignedStatsAllChains(
    days: number,
  ): Promise<Result<Map<string, DailyBlockStats[]>, Error>> {
    return blockQueries.getDailySignedStatsAllChains(this.nextReadConn(), this.log, days);
  }

  public getLatestBlocksAllChains(
    chainTypes: Map<string, "bft" | "tm2">,
  ): Promise<Result<Map<string, Block>, Error>> {
    return blockQueries.getLatestBlocksAllChains(this.nextReadConn, this.log, chainTypes);
  }
}
