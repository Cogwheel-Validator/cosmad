import type { Result } from "../models/result";
import type { BlockWindowStats, ChainSignatureStats, DailyBlockStats } from "./analytics";
import type { Alert, Block, ValidatorInactivity } from "./tables";

// Interface for methods that provide read only access to the database.
// Necessary for the databases where you need to read but not write.
export interface IReadDb {
  latestBlock(): Promise<Result<Block | null, Error>>;
  latestBlockHeight(): Promise<Result<bigint | null, Error>>;
  getBlockByHeight(height: bigint): Promise<Result<Block | null, Error>>;
  getBlockByRange(startHeight: bigint, endHeight: bigint): Promise<Result<Block[], Error>>;
  getBlockStats(startHeight: bigint, endHeight: bigint): Promise<Result<BlockWindowStats, Error>>;
  getChainSignedPercentage(days: number): Promise<Result<ChainSignatureStats | null, Error>>;
  getDailySignedStats(days: number): Promise<Result<DailyBlockStats[], Error>>;
  getAlert(alertKey: string): Promise<Result<Alert | null, Error>>;
  getUnclosedAlerts(limit: number, page: number): Promise<Result<Alert[], Error>>;
  // The ongoing validator inactivity period, if the validator is currently out of the active set.
  getOpenInactivity(): Promise<Result<ValidatorInactivity | null, Error>>;
  // Inactivity periods, newest first.
  getInactivityHistory(limit: number): Promise<Result<ValidatorInactivity[], Error>>;
  close(): void;
}

// Interface for methods that provide read/write access to the database.
export interface IWriteDb extends IReadDb {
  // Special methods for appending/inserting large amount of blocks.
  // If the database does support it implement it, Otherwise shadow it with a simple insertBlocks method.
  appendBlocks(blocks: Block[]): Promise<Result<void, Error>>;
  insertBlocks(blocks: Block[]): Promise<Result<void, Error>>;
  insertAlert(alert: Alert): Promise<Result<void, Error>>;
  closeAlert(alertId: string, closedAt: Date): Promise<Result<void, Error>>;
  // Special method for updating the last notified time of an alert.
  touchAlertNotified(
    alertId: string,
    notifiedAt: Date,
    repeatCount: number,
  ): Promise<Result<void, Error>>;
  // Start a validator inactivity period / end the one that started at startHeight.
  insertInactivity(period: ValidatorInactivity): Promise<Result<void, Error>>;
  endInactivity(
    startHeight: bigint,
    endHeight: bigint,
    endTime: Date,
  ): Promise<Result<void, Error>>;
  // Close the database connection.
  close(): void;
}

// Interface for the subset of IReadDb the API process actually calls, plus the chain-agnostic
// overview reads (one round trip covering every chain, instead of the per-chain methods above
// called once per chain). Only ApiEngineClient implements this, so these live here rather than
// on IReadDb - a chain-scoped IWriteDb/IReadDb implementor has no sensible way to answer them.
export type IApiReadDb = Pick<
  IReadDb,
  | "latestBlock"
  | "latestBlockHeight"
  | "getAlert"
  | "getUnclosedAlerts"
  | "close"
  | "getChainSignedPercentage"
  | "getDailySignedStats"
  | "getBlockByHeight"
  | "getBlockByRange"
> & {
  getOverviewLatestBlocks(): Promise<Result<Map<string, Block>, Error>>;
  getOverviewDailyStats(days: number): Promise<Result<Map<string, DailyBlockStats[]>, Error>>;
};
