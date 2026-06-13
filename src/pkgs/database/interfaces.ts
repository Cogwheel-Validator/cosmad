import type { Alert, Block } from "./tables";

export interface DbWriteResult {
  success: boolean;
  error?: string;
}

export interface DbQueryResult<T> {
  success: boolean;
  error?: string;
  result?: T;
}

export interface IReadDb {
  latestBlock(): Promise<DbQueryResult<Block | null>>;
  latestBlockHeight(): Promise<DbQueryResult<bigint | null>>;
  getAlert(alertKey: string): Promise<DbQueryResult<Alert | null>>;
  getUnclosedAlerts(): Promise<DbQueryResult<Alert[]>>;
  close(): void;
}

export interface IWriteDb extends IReadDb {
  appendBlocks(blocks: Block[]): Promise<DbWriteResult>;
  insertBlocks(blocks: Block[]): Promise<DbWriteResult>;
  insertAlert(alert: Alert): Promise<DbWriteResult>;
  close(): void;
}
