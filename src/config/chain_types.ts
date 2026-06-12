import { type } from "arktype";
import { AlertConfig } from "./alert_types";

export const Apis = type({
  url: "string.url",
  alertIfDown: "boolean",
});

export const ChainConfig = type({
  prettyName: "string",
  chainType: "'bft' | 'tm2'",
  "chainLogo?": "string",
  valoperAddress: "string",
  "valconsAddress?": "string", // only available for bft chains, leave undefined for tm2 chains
  rpcUrls: Apis.array(),
  "apiUrls?": Apis.array(), // only available for bft chains, leave undefined for tm2 chains
  /** How often to poll the RPC endpoint (ms). Defaults to 6 000. */
  "pollIntervalMs?": "number.integer",
  alertConfig: AlertConfig,
});

export type ChainConfigType = typeof ChainConfig.infer;
