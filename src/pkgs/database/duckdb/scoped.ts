import type { Result } from "../../models/result";
import type { BlockWindowStats, ChainSignatureStats, DailyBlockStats } from "../analytics";
import type { IWriteDb } from "../interfaces";
import type { Alert, Block } from "../tables";
import type { RWDB } from "./rw_db";

/** Binds a chain ID to a shared RWDB, implementing IWriteDb for in-process (non-socket) callers. */
export class ChainScopedDb implements IWriteDb {
  constructor(
    private db: RWDB,
    private chainId: string,
    private chainType: "bft" | "tm2",
  ) {}

  public appendBlocks(blocks: Block[]): Promise<Result<void, Error>> {
    return this.db.appendBlocks(this.chainId, blocks);
  }

  public insertBlocks(blocks: Block[]): Promise<Result<void, Error>> {
    return this.db.insertBlocks(this.chainId, blocks);
  }

  public latestBlock(): Promise<Result<Block | null, Error>> {
    return this.db.latestBlock(this.chainId, this.chainType);
  }

  public latestBlockHeight(): Promise<Result<bigint | null, Error>> {
    return this.db.latestBlockHeight(this.chainId);
  }

  public insertAlert(alert: Alert): Promise<Result<void, Error>> {
    return this.db.insertAlert(alert);
  }

  public getAlert(alertKey: string): Promise<Result<Alert | null, Error>> {
    return this.db.getAlert(alertKey);
  }

  public getUnclosedAlerts(): Promise<Result<Alert[], Error>> {
    return this.db.getUnclosedAlerts(this.chainId);
  }

  public closeAlert(alertId: string, closedAt: Date): Promise<Result<void, Error>> {
    return this.db.closeAlert(alertId, closedAt);
  }

  public touchAlertNotified(
    alertId: string,
    notifiedAt: Date,
    repeatCount: number,
  ): Promise<Result<void, Error>> {
    return this.db.touchAlertNotified(alertId, notifiedAt, repeatCount);
  }

  public getBlockByRange(startHeight: bigint, endHeight: bigint): Promise<Result<Block[], Error>> {
    return this.db.getBlockByRange(this.chainId, startHeight, endHeight, this.chainType);
  }

  public getBlockByHeight(height: bigint): Promise<Result<Block | null, Error>> {
    return this.db.getBlockByHeight(this.chainId, height, this.chainType);
  }

  public getBlockStats(
    startHeight: bigint,
    endHeight: bigint,
  ): Promise<Result<BlockWindowStats, Error>> {
    return this.db.getBlockStats(this.chainId, startHeight, endHeight);
  }

  public getChainSignedPercentage(
    days: number,
  ): Promise<Result<ChainSignatureStats | null, Error>> {
    return this.db.getChainSignedPercentage(this.chainId, days);
  }

  public getDailySignedStats(days: number): Promise<Result<DailyBlockStats[], Error>> {
    return this.db.getDailySignedStats(this.chainId, days);
  }

  /** No-op: the underlying connection is shared across chains - call RWDB.close() once. */
  public close(): void {}
}
