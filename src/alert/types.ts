import type { Alert } from "@/pkgs/database/tables";

/**
 * Snapshot of chain state at the moment an alert was evaluated, carried through to
 * notifications.
 */
export interface AlertContext {
  latestBlockHeight?: string;
  latestBlockTime?: Date;
  windowTotal?: number;
  windowMissed?: number;
  windowMissedPercent?: number;
  consecutiveMissed?: number;
  threshold?: number;
  /** Why an endpoint is considered down (rpc_down / api_down). */
  reason?: string;
  /** Validator bond status (inactive / jailed / tombstoned). */
  bondStatus?: string;
  /** End of the validator's jail (jailed). */
  jailedUntil?: Date;
}

/**
 * The tracked validator's status at a specific height, resolved by the chain worker from the
 * staking validator endpoint (jailed, bond status) and, when jailed, the slashing signing info
 * (jailed until, tombstoned).
 */
export interface ValidatorStatus {
  height: bigint;
  time: Date;
  /** In the active set: bonded and not jailed. */
  active: boolean;
  jailed: boolean;
  /** Tombstoned - jailed forever. */
  permanent: boolean;
  bondStatus: string;
  jailedUntil?: Date;
}

/** Input for rpc_down/api_down evaluation: one configured endpoint and its last known health. */
export interface EndpointCheck {
  kind: "rpc" | "api";
  url: string;
  alertIfDown: boolean;
  /** undefined while the endpoint hasn't been health checked yet. */
  healthy: boolean | undefined;
  reason?: string;
}

export type AlertEvent =
  | { kind: "open"; alert: Alert; context: AlertContext }
  | { kind: "close"; alert: Alert; closedAt: Date; context: AlertContext }
  | { kind: "repeat"; alert: Alert; context: AlertContext };
