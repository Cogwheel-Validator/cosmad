import type { Result } from "../models/result";
import type { ChainSignatureStats } from "./analytics";
import type { Alert, Block } from "./tables";

// Interface for methods that provide read only access to the database.
// Necessary for the databases where you need to read but not write.
export interface IReadDb {
  latestBlock(): Promise<Result<Block | null, Error>>;
  latestBlockHeight(): Promise<Result<bigint | null, Error>>;
  getChainSignedPercentage(days: number): Promise<Result<ChainSignatureStats | null, Error>>;
  getAlert(alertKey: string): Promise<Result<Alert | null, Error>>;
  getUnclosedAlerts(): Promise<Result<Alert[], Error>>;
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
  // Close the database connection.
  close(): void;
}
