import { randomUUID } from "node:crypto";
import { Column, Table } from "./sql/decorators";
import { AllowedTypes } from "./sql/types";

interface BlockOptions {
  chainId: string;
  height: bigint;
  hash: string | Buffer;
  time: Date;
  signed: number;
  signature: string | Buffer | undefined;
  precommitted?: boolean | undefined;
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

  // Whether the block was precommitted or not. It is null if there was no signature.
  @Column({ name: "precommitted", type: AllowedTypes.BOOLEAN, nullable: true })
  precommitted?: boolean;

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
    if (options.precommitted !== undefined) {
      this.precommitted = options.precommitted;
    }
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
  subject?: string;
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

  // What the alert is about, for alert types that can be open several times at once - e.g. the
  // endpoint URL of an rpc_down/api_down alert. Null for chain-wide alerts.
  @Column({ name: "subject", type: AllowedTypes.TEXT, nullable: true })
  subject?: string;

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
    if (options.subject !== undefined) {
      this.subject = options.subject;
    }
    if (options.closedAt !== undefined) {
      this.closedAt = options.closedAt;
    }
    if (options.lastNotifiedAt !== undefined) {
      this.lastNotifiedAt = options.lastNotifiedAt;
    }
  }

  /**
   * Generates a fresh, unique ID for a new alert incident using UUIDv4
   */
  public static generateId(): string {
    return randomUUID();
  }
}

interface ValidatorInactivityOptions {
  chainId: string;
  height: bigint;
  time: Date;
  jailed: boolean;
  permanent: boolean;
  bondStatus: string;
  jailedUntil?: Date;
  endHeight?: bigint;
  endTime?: Date;
}

/**
 * One period during which the tracked validator was outside the active set, and why.
 * - jailed = false, permanent = false: not jailed, simply not in the active set (outranked by
 *   stake, or the active set size was lowered).
 * - jailed = true, permanent = false: jailed (e.g. downtime), can unjail after jailedUntil.
 * - jailed = true, permanent = true: tombstoned (double sign), jailed forever.
 * A new period starts whenever the reason changes (e.g. a jailed validator getting tombstoned).
 * endHeight/endTime stay null while the period is ongoing.
 */
@Table("validator_inactivity")
export class ValidatorInactivity {
  @Column({ name: "chain_id", type: AllowedTypes.TEXT, primary: true, nullable: false })
  chainId: string;

  // Height at which cosmad observed this state (the chain tip of that poll).
  @Column({ name: "height", type: AllowedTypes.UBIGINT, primary: true, nullable: false })
  height: bigint;

  // Block time of `height`.
  @Column({ name: "time", type: AllowedTypes.TIMESTAMP, nullable: false })
  time: Date;

  @Column({ name: "jailed", type: AllowedTypes.BOOLEAN, nullable: false })
  jailed: boolean;

  // Tombstoned - the validator can never unjail.
  @Column({ name: "permanent", type: AllowedTypes.BOOLEAN, nullable: false })
  permanent: boolean;

  // BOND_STATUS_UNBONDING / BOND_STATUS_UNBONDED / ...
  @Column({ name: "bond_status", type: AllowedTypes.TEXT, nullable: false })
  bondStatus: string;

  @Column({ name: "jailed_until", type: AllowedTypes.TIMESTAMP, nullable: true })
  jailedUntil?: Date;

  @Column({ name: "end_height", type: AllowedTypes.UBIGINT, nullable: true })
  endHeight?: bigint;

  @Column({ name: "end_time", type: AllowedTypes.TIMESTAMP, nullable: true })
  endTime?: Date;

  constructor(options: ValidatorInactivityOptions) {
    this.chainId = options.chainId;
    this.height = options.height;
    this.time = options.time;
    this.jailed = options.jailed;
    this.permanent = options.permanent;
    this.bondStatus = options.bondStatus;
    if (options.jailedUntil !== undefined) this.jailedUntil = options.jailedUntil;
    if (options.endHeight !== undefined) this.endHeight = options.endHeight;
    if (options.endTime !== undefined) this.endTime = options.endTime;
  }
}

@Table("cosmad_version")
export class Version {
  @Column({ name: "version", type: AllowedTypes.TEXT, primary: true, nullable: false })
  version: string;

  @Column({ name: "applied_at", type: AllowedTypes.TIMESTAMP, nullable: false })
  appliedAt: Date;

  constructor(version: string, appliedAt: Date) {
    this.version = version;
    this.appliedAt = appliedAt;
  }
}
