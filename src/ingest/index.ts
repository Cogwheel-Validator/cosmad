import type { Logger } from "pino";
import type { IWriteDb } from "@/pkgs/database/interfaces";
import type { Alert, Block } from "@/pkgs/database/tables";
import logger from "@/pkgs/logger";
import type { Result } from "@/pkgs/models/result";

export class IngestLayer {
  private log: Logger;

  constructor(
    private db: IWriteDb,
    chainId: string,
  ) {
    this.log = logger.child({ module: `IngestLayer:${chainId}` });
  }

  async ingestBlocks(blocks: Block[]): Promise<Result<void, Error>> {
    if (blocks.length === 0) return { ok: true, value: undefined };
    const result = await this.db.appendBlocks(blocks);
    if (!result.ok) {
      this.log.warn("appendBlocks failed (%s), retrying with insertBlocks", result.error);
      return this.db.insertBlocks(blocks);
    }
    return result;
  }

  async ingestAlert(alert: Alert): Promise<Result<void, Error>> {
    const existing = await this.db.getAlert(alert.alertId);
    if (!existing.ok) {
      return existing;
    }
    if (existing.value != null) {
      this.log.debug("Alert %s already present, skipping insert", alert.alertId);
      return { ok: true, value: undefined };
    }
    return this.db.insertAlert(alert);
  }

  async closeAlert(alertId: string, closedAt: Date): Promise<Result<void, Error>> {
    return this.db.closeAlert(alertId, closedAt);
  }
}
