import { createHash } from "node:crypto";
import { DuckDBBlobValue, DuckDBTimestampValue, type DuckDBValue } from "@duckdb/node-api";
import { Column, Table } from "./sql/decorators";
import { AllowedTypes } from "./sql/types";

interface BlockOptions {
  height: bigint;
  hash: string;
  time: Date;
  signed: boolean;
  signature?: string;
  chainType: "bft" | "tm2";
}

export interface BlockDuckDbData {
  height: bigint;
  hash: DuckDBBlobValue;
  time: DuckDBTimestampValue;
  signed: boolean;
  signature: DuckDBBlobValue | null;
}

@Table("blocks")
export class Block {
  @Column({ name: "height", type: AllowedTypes.UBIGINT, primary: true, nullable: false })
  height: bigint;

  @Column({ name: "hash", type: AllowedTypes.BYTEA, nullable: false })
  hash: Buffer;

  @Column({ name: "time", type: AllowedTypes.TIMESTAMP, nullable: false })
  time: Date;

  @Column({ name: "signed", type: AllowedTypes.BOOLEAN, nullable: false, index: true })
  signed: boolean;

  @Column({ name: "signature", type: AllowedTypes.BYTEA, nullable: true })
  signature?: Buffer;

  constructor(options: BlockOptions) {
    const hash = (): Buffer => {
      switch (options.chainType) {
        case "bft":
          return Buffer.from(options.chainType, "hex");
        case "tm2":
          return Buffer.from(options.chainType, "base64");
        default:
          throw new Error(`Unknown chain type: ${options.chainType}`);
      }
    };
    this.height = options.height;
    this.hash = hash();
    this.time = options.time;
    this.signed = options.signed;
    if (options.signature !== undefined) {
      this.signature = Buffer.from(options.signature, "base64");
    }
  }

  public get getTableName() {
    return "blocks";
  }

  public toDuckDbData(): BlockDuckDbData {
    return {
      height: this.height,
      hash: new DuckDBBlobValue(this.hash),
      time: new DuckDBTimestampValue(BigInt(this.time.getTime()) * 1000n),
      signed: this.signed,
      signature: this.signature != null ? new DuckDBBlobValue(this.signature) : null,
    };
  }

  public static fromDuckDbData(data: Record<string, DuckDBValue>): Block {
    const block = Object.create(Block.prototype) as Block;
    block.height = data.height as bigint;
    block.hash = Buffer.from((data.hash as DuckDBBlobValue).bytes);
    block.time = new Date(Number((data.time as DuckDBTimestampValue).micros) / 1000);
    block.signed = data.signed as boolean;
    if (data.signature != null) {
      block.signature = Buffer.from((data.signature as DuckDBBlobValue).bytes);
    }
    return block;
  }
}

interface AlertOptions {
  alertId: string;
  chainId: string;
  alertType: string;
  openedAt: Date;
  closedAt?: Date;
}

export interface AlertDuckDbData {
  alertId: string;
  chainId: string;
  alertType: string;
  openedAt: DuckDBTimestampValue;
  closedAt: DuckDBTimestampValue | null;
}

@Table("alerts")
export class Alert {
  @Column({
    name: "alert_id",
    type: AllowedTypes.VARCHAR,
    primary: true,
    nullable: false,
    varcharLen: 64,
  })
  alertId: string;

  @Column({ name: "chain_id", type: AllowedTypes.TEXT, nullable: false })
  chainId: string;

  @Column({ name: "alert_type", type: AllowedTypes.TEXT, nullable: false })
  alertType: string;

  @Column({ name: "opened_at", type: AllowedTypes.TIMESTAMP, nullable: false })
  openedAt: Date;

  @Column({ name: "closed_at", type: AllowedTypes.TIMESTAMP, nullable: true })
  closedAt?: Date;

  constructor(options: AlertOptions) {
    this.alertId = options.alertId;
    this.chainId = options.chainId;
    this.alertType = options.alertType;
    this.openedAt = options.openedAt;
    if (options.closedAt !== undefined) {
      this.closedAt = options.closedAt;
    }
  }

  public get getTableName() {
    return "alerts";
  }

  public toDuckDbData(): AlertDuckDbData {
    return {
      alertId: this.alertId,
      chainId: this.chainId,
      alertType: this.alertType,
      openedAt: new DuckDBTimestampValue(BigInt(this.openedAt.getTime()) * 1000n),
      closedAt:
        this.closedAt != null
          ? new DuckDBTimestampValue(BigInt(this.closedAt.getTime()) * 1000n)
          : null,
    };
  }

  /**
   * Generate a deterministic SHA-256 dedup key from the alert's identifying fields.
   * This key is stable across restarts and can be used as a PagerDuty dedup_key.
   */
  public static generateKey(chainId: string, alertType: string): string {
    return createHash("sha256").update(`${chainId}:${alertType}`).digest("hex");
  }

  public static fromDuckDbData(data: Record<string, DuckDBValue>): Alert {
    const alert = Object.create(Alert.prototype) as Alert;
    alert.alertId = data.alert_id as string;
    alert.chainId = data.chain_id as string;
    alert.alertType = data.alert_type as string;
    alert.openedAt = new Date(Number((data.opened_at as DuckDBTimestampValue).micros) / 1000);
    if (data.closed_at != null) {
      alert.closedAt = new Date(Number((data.closed_at as DuckDBTimestampValue).micros) / 1000);
    }
    return alert;
  }
}
