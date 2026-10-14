/** biome-ignore-all lint/suspicious/noConfusingVoidType: <result requires void since we are mapping the result to a response> */
import { ChainSignatureStats } from "../pkgs/database/analytics";
import { Alert, Block, ValidatorInactivity } from "../pkgs/database/tables";

/**
 * JSON-safe wire shapes for Block/Alert, since JSON can't carry bigint, Buffer,
 * or Date directly. Sent as newline-delimited JSON over the engine's Unix socket.
 */

// WireBlock is the JSON-safe wire shape for a Block.
export interface WireBlock {
  chainId: string;
  height: string;
  hash: string;
  time: string;
  signed: number;
  signature?: string;
  precommitted?: boolean;
}

/** WireAlert is the JSON-safe wire shape for an Alert. */
export interface WireAlert {
  alertId: string;
  chainId: string;
  alertType: string;
  subject?: string;
  openedAt: string;
  closedAt?: string;
  lastNotifiedAt?: string;
  repeatCount: number;
}

/** A converter function for converting a Block to its JSON-safe wire shape.
 * @param block The Block to convert to a WireBlock.
 */
export function blockToWire(block: Block, chainType: "bft" | "tm2"): WireBlock {
  let hash: string;
  if (chainType === "tm2") {
    hash = block.hash.toString("base64");
  } else {
    hash = block.hash.toString("hex");
  }
  return {
    chainId: block.chainId,
    height: block.height.toString(),
    hash: hash,
    time: block.time.toISOString(),
    signed: block.signed,
    ...(block.signature != null ? { signature: block.signature.toString("base64") } : {}),
    ...(block.precommitted != null ? { precommitted: block.precommitted } : {}),
  };
}

/** A converter function for converting a WireBlock to a Block.
 * @param wire The WireBlock to convert to a Block.
 */
export function wireToBlock(wire: WireBlock, chainType: "bft" | "tm2"): Block {
  const signature = wire.signature != null ? Buffer.from(wire.signature, "base64") : undefined;
  return new Block({
    chainId: wire.chainId,
    height: BigInt(wire.height),
    hash: wire.hash,
    time: new Date(wire.time),
    signed: wire.signed,
    chainType: chainType,
    signature: signature,
    ...(wire.precommitted != null ? { precommitted: wire.precommitted } : {}),
  });
}

/** A converter function for converting an Alert to its JSON-safe wire shape.
 * @param alert The Alert to convert to a WireAlert.
 */
export function alertToWire(alert: Alert): WireAlert {
  return {
    alertId: alert.alertId,
    chainId: alert.chainId,
    alertType: alert.alertType,
    ...(alert.subject != null ? { subject: alert.subject } : {}),
    openedAt: alert.openedAt.toISOString(),
    ...(alert.closedAt != null ? { closedAt: alert.closedAt.toISOString() } : {}),
    ...(alert.lastNotifiedAt != null ? { lastNotifiedAt: alert.lastNotifiedAt.toISOString() } : {}),
    repeatCount: alert.repeatCount,
  };
}

/** A converter function for converting a WireAlert to an Alert.
 * @param wire The WireAlert to convert to an Alert.
 */
export function wireToAlert(wire: WireAlert): Alert {
  return new Alert({
    alertId: wire.alertId,
    chainId: wire.chainId,
    alertType: wire.alertType,
    ...(wire.subject != null ? { subject: wire.subject } : {}),
    openedAt: new Date(wire.openedAt),
    repeatCount: wire.repeatCount,
    ...(wire.closedAt != null ? { closedAt: new Date(wire.closedAt) } : {}),
    ...(wire.lastNotifiedAt != null ? { lastNotifiedAt: new Date(wire.lastNotifiedAt) } : {}),
  });
}

/** WireInactivity is the JSON-safe wire shape for a ValidatorInactivity. */
export interface WireInactivity {
  chainId: string;
  height: string;
  time: string;
  jailed: boolean;
  permanent: boolean;
  bondStatus: string;
  jailedUntil?: string;
  endHeight?: string;
  endTime?: string;
}

export function inactivityToWire(period: ValidatorInactivity): WireInactivity {
  return {
    chainId: period.chainId,
    height: period.height.toString(),
    time: period.time.toISOString(),
    jailed: period.jailed,
    permanent: period.permanent,
    bondStatus: period.bondStatus,
    ...(period.jailedUntil != null ? { jailedUntil: period.jailedUntil.toISOString() } : {}),
    ...(period.endHeight != null ? { endHeight: period.endHeight.toString() } : {}),
    ...(period.endTime != null ? { endTime: period.endTime.toISOString() } : {}),
  };
}

export function wireToInactivity(wire: WireInactivity): ValidatorInactivity {
  return new ValidatorInactivity({
    chainId: wire.chainId,
    height: BigInt(wire.height),
    time: new Date(wire.time),
    jailed: wire.jailed,
    permanent: wire.permanent,
    bondStatus: wire.bondStatus,
    ...(wire.jailedUntil != null ? { jailedUntil: new Date(wire.jailedUntil) } : {}),
    ...(wire.endHeight != null ? { endHeight: BigInt(wire.endHeight) } : {}),
    ...(wire.endTime != null ? { endTime: new Date(wire.endTime) } : {}),
  });
}

/** WireChainSignatureStats is the JSON-safe wire shape for a ChainSignatureStats - already
 * plain numbers/strings, so it's a straight field-for-field mirror. */
export interface WireChainSignatureStats {
  chainId: string;
  percentageSigned: number;
  percentageMissed: number;
}

export function chainSignatureStatsToWire(stats: ChainSignatureStats): WireChainSignatureStats {
  return {
    chainId: stats.chainId,
    percentageSigned: stats.percentageSigned,
    percentageMissed: stats.percentageMissed,
  };
}

export function wireToChainSignatureStats(wire: WireChainSignatureStats): ChainSignatureStats {
  return new ChainSignatureStats(wire.chainId, wire.percentageSigned, wire.percentageMissed);
}

export type chainType = "bft" | "tm2";

export interface EngineOps {
  appendBlocks: { params: { chainId: string; blocks: WireBlock[] }; result: void };
  insertBlocks: { params: { chainId: string; blocks: WireBlock[] }; result: void };
  latestBlock: { params: { chainId: string; chainType: chainType }; result: WireBlock | null };
  latestBlockHeight: { params: { chainId: string }; result: string | null };
  insertAlert: { params: { chainId: string; alert: WireAlert }; result: void };
  getAlert: { params: { chainId: string; alertKey: string }; result: WireAlert | null };
  getUnclosedAlerts: {
    params: { chainId: string; limit: number; page: number };
    result: WireAlert[];
  };
  closeAlert: { params: { chainId: string; alertId: string; closedAt: string }; result: void };
  touchAlertNotified: {
    params: { chainId: string; alertId: string; notifiedAt: string; repeatCount: number };
    result: void;
  };
  insertInactivity: { params: { chainId: string; period: WireInactivity }; result: void };
  endInactivity: {
    params: { chainId: string; startHeight: string; endHeight: string; endTime: string };
    result: void;
  };
  getOpenInactivity: { params: { chainId: string }; result: WireInactivity | null };
  getInactivityHistory: { params: { chainId: string; limit: number }; result: WireInactivity[] };
  getBlockByHeight: {
    params: { chainId: string; blockHeight: string; chainType: chainType };
    result: WireBlock | null;
  };
  getBlockByRange: {
    params: { chainId: string; startHeight: string; endHeight: string; chainType: chainType };
    result: WireBlock[];
  };
  getBlockStats: {
    params: { chainId: string; startHeight: string; endHeight: string };
    result: { total: number; missed: number };
  };
  getChainSignedPercentage: {
    params: { chainId: string; days: number };
    result: WireChainSignatureStats | null;
  };
  getDailySignedStats: {
    params: { chainId: string; days: number };
    result: { date: string; total: number; missed: number }[];
  };
  // Chain-agnostic ops for the overview endpoint - one round trip for every chain instead of one per chain.
  getOverviewDailyStats: {
    params: { days: number };
    result: { chainId: string; daily: { date: string; total: number; missed: number }[] }[];
  };
  getOverviewLatestBlocks: {
    params: unknown;
    result: { chainId: string; block: WireBlock }[];
  };
}

/** The result type for a given op key - e.g. `ResultOf<"getAlert">` is `WireAlert | null`. */
export type ResultOf<K extends keyof EngineOps> = EngineOps[K]["result"];

export type EngineRequestBody = {
  [K in keyof EngineOps]: { type: K } & EngineOps[K]["params"];
}[keyof EngineOps];

/** Every request type that mutates state - rejected on "reader" role connections. */
export const WRITE_REQUEST_TYPES: ReadonlySet<EngineRequestBody["type"]> = new Set([
  "appendBlocks",
  "insertBlocks",
  "insertAlert",
  "closeAlert",
  "touchAlertNotified",
  "insertInactivity",
  "endInactivity",
]);

export interface EngineRequest {
  id: number;
  body: EngineRequestBody;
}

export type EngineResponseBody = { ok: true; value: unknown } | { ok: false; error: string };

export interface EngineResponse {
  id: number;
  body: EngineResponseBody;
}

export type EngineRole = "reader" | "writer";

// Entrypoint to connect to the Unix socket message.
export interface HelloMessage {
  type: "hello";
  role: EngineRole;
}
