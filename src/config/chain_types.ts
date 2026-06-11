import { type } from "arktype";
import { AlertConfig } from "./alert_types";

export const Apis = type({
  url: "string.url.parse",
  alertIfDown: "boolean",
});

export const ChainConfig = type({
  chainId: "string",
  prettyName: "string",
  chainType: "'bft' | 'tm2'",
  chainLogo: "string | undefined",
  valoperAddress: "string",
  valconsAddress: "string | undefined", // only available for bft chains, leave undefined for tm2 chains
  rpcUrls: Apis.array(),
  apiUrls: Apis.array().or(type.undefined),
  /** How often to poll the RPC endpoint (ms). Defaults to 6 000. */
  pollIntervalMs: "number | undefined",
  alertConfig: AlertConfig,
});
