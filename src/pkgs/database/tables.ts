import { createHash } from "node:crypto";
import { Column, Table } from "./sql/decorators";
import { AllowedTypes } from "./sql/types";

interface BlockOptions {
  chainId: string;
  height: bigint;
  hash: string | Buffer;
  time: Date;
  signed: number;
  signature: string | Buffer | undefined;
  chainType: "bft" | "tm2";
}

@Table("blocks")
export class Block {
  @Column({ name: "chain_id", type: AllowedTypes.TEXT, primary: true, nullable: false })
  chainId: string;

  @Column({ name: "height", type: AllowedTypes.UBIGINT, primary: true, nullable: false })
  height: bigint;

  @Column({ name: "hash", type: AllowedTypes.BYTEA, nullable: false })
  hash: Buffer;

  @Column({ name: "time", type: AllowedTypes.TIMESTAMP, nullable: false })
  time: Date;

  // -1 = Wasn't active, 0 = Active but missed, 1 = Active and signed
  @Column({ name: "signed", type: AllowedTypes.TINYINT, nullable: false, index: true })
  signed: number;

  @Column({ name: "signature", type: AllowedTypes.BYTEA, nullable: true })
  signature: Buffer | undefined;

  chainType: "bft" | "tm2";

  private hashFn = (opt: BlockOptions): Buffer => {
    if (opt.hash instanceof Buffer) {
      return opt.hash;
    }
    switch (this.chainType) {
      case "bft":
        return Buffer.from(opt.hash as string, "hex");
      case "tm2":
        return Buffer.from(opt.hash as string, "base64");
      default:
        throw new Error(`Unknown chain type: ${opt.chainType}`);
    }
  };

  private numCheck = (opt: BlockOptions): number => {
    if (opt.signed >= -1 && opt.signed <= 1) {
      return opt.signed;
    }
    throw new Error(`Invalid signed value: ${opt.signed}`);
  };

  private signatureFn = (opt: BlockOptions): Buffer | undefined => {
    if (opt.signature instanceof Buffer) {
      return opt.signature;
    } else if (typeof opt.signature === "string") {
      return Buffer.from(opt.signature, "base64");
    }
    return undefined;
  };

  constructor(options: BlockOptions) {
    this.chainId = options.chainId;
    this.height = options.height;
    this.chainType = options.chainType;
    this.hash = this.hashFn(options);
    this.time = options.time;
    this.signed = this.numCheck(options);
    this.signature = this.signatureFn(options);
  }

  // blockSignature returns a base64 representation of the signature, if it exists
  public get blockSignature(): string | undefined {
    return this.signature != null ? this.signature.toString("base64") : undefined;
  }

  public get blockHash(): string {
    switch (this.chainType) {
      case "bft":
        return this.hash.toString("hex");
      case "tm2":
        return this.hash.toString("base64");
    }
    // unsupported chain type, return empty string
    // should never happen in theory
    return "";
  }
}

interface AlertOptions {
  alertId: string;
  chainId: string;
  alertType: string;
  openedAt: Date;
  closedAt?: Date;
  lastNotifiedAt?: Date;
  repeatCount?: number;
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

  @Column({ name: "last_notified_at", type: AllowedTypes.TIMESTAMP, nullable: true })
  lastNotifiedAt?: Date;

  @Column({
    name: "repeat_count",
    type: AllowedTypes.INTEGER,
    nullable: false,
    default: "0",
  })
  repeatCount: number;

  constructor(options: AlertOptions) {
    this.alertId = options.alertId;
    this.chainId = options.chainId;
    this.alertType = options.alertType;
    this.openedAt = options.openedAt;
    this.repeatCount = options.repeatCount ?? 0;
    if (options.closedAt !== undefined) {
      this.closedAt = options.closedAt;
    }
    if (options.lastNotifiedAt !== undefined) {
      this.lastNotifiedAt = options.lastNotifiedAt;
    }
  }

  /**
   * Generate a deterministic SHA-256 dedup key from the alert's identifying fields.
   * This key is stable across restarts and can be used as a PagerDuty dedup_key.
   */
  public static generateKey(chainId: string, alertType: string): string {
    return createHash("sha256").update(`${chainId}:${alertType}`).digest("hex");
  }
}
