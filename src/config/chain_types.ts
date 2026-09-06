import { type } from "arktype";
import { AlertConfig } from "./alert_types";

export const Apis = type({
  url: "string.url",
  alertIfDown: "boolean",
});

const ChainConfigBase = type({
  prettyName: "string",
  "chainLogo?": "string",
  rpcUrls: Apis.array(),
  "apiUrls?": Apis.array(), // only available for bft chains, leave undefined for tm2 chains
  /** How often to poll the RPC endpoint (ms). Defaults to 6 000. */
  "pollIntervalMs?": "number.integer",
  // Max number of commit requests in flight at once when backfilling a range of blocks (e.g.
  // after downtime). Smaller batches are gentler on rate-limited RPCs at the cost of slower
  // catch-up. Defaults to 25 if unset.
  "rangeChunkSize?": "number.integer > 0",
  // Max number of blocks fetched AND ingested per poll cycle when there's a backlog (e.g. after
  // downtime or a first run against an old chain tip). A large gap is worked off gradually
  // across many poll cycles instead of one giant fetch and dump into database.
  // Defaults to 100 if unset.
  "maxBlocksPerPoll?": "number.integer > 0",
  // EXPERIMENTAL!
  // If a commit fetch permanently fails (exhausts its retries) partway through a poll's range,
  // the default behavior is to stop ingesting right before that height and retry it every
  // subsequent poll. Normal behaviour is to stop ingesting right before that height and retry
  // it every subsequent poll.
  //
  // If for some unforeseen reason a commit fetch permanently fails, set this to true to instead
  // skip the failed height and continue past it, accepting a permanent gap - only useful in rare
  // cases where a specific block is known to be permanently unfetchable (e.g. pruned by all configured RPCs)
  // and you'd rather not have that one height block all further ingestion. Defaults to false.
  // And also only enable it until you skip over the troublesome commit.
  "allowBlockGaps?": "boolean",
  alertConfig: AlertConfig,
});

const BftChainConfig = ChainConfigBase.and({
  chainType: "'bft'",
  valoperAddress: "string",
  valconsAddress: "string",
});

const Tm2ChainConfig = ChainConfigBase.and({
  chainType: "'tm2'",
  operatorAddress: "string",
  signingAddress: "string",
});

export const ChainConfig = BftChainConfig.or(Tm2ChainConfig);
export type ChainConfigType = typeof ChainConfig.infer;
