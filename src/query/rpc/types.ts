import { type } from "arktype";

export const RpcError = type({
  code: "number",
  message: "string",
  data: "string",
});

const RpcResponse = type({
  jsonrpc: "'2.0'", // literal string, not any string
  id: "number | string", // JSON-RPC id can be either
  "error?": RpcError,
});

const RpcStatus = type({
  nodeInfo: {
    network: "string",
    version: "string",
  },
  syncInfo: {
    latestBlockHeight: "string.integer",
    latestBlockTime: "string.date.iso.parse",
    catchingUp: "boolean",
  },
});

export const RpcStatusSchema = RpcResponse.and({
  result: RpcStatus,
});

const CosmosHeaderVersion = type({
  block: "string.integer",
});

const Tm2HeaderVersion = type("string");

const BlockId = type({
  hash: "string",
  parts: {
    total: "number | string.numeric.parse",
    hash: "string",
  },
});

const CosmosCommitSigners = type({
  blockIdFlag: "0 <= number <= 3",
  validatorAddress: "string.alphanumeric == 40 | string == 0",
  timestamp: "string.date.iso",
  signature: "string.base64 == 88| null",
})
  .or("null")
  .array();

// A precommit block id for TM2
const PrecommitBlockId = type({
  hash: "string | null",
  parts: {
    total: "number | string.numeric.parse",
    hash: "string | null",
  },
});

const Tm2Precommits = type({
  type: "0 <= number <= 3",
  height: "string.integer.parse",
  blockId: PrecommitBlockId,
  timestamp: "string.date.iso",
  validatorAddress: "string.alphanumeric",
  signature: "string.base64 == 88| null",
  validatorIndex: "string.integer.parse",
})
  .or("null")
  .array();

const CosmosCommit = type({
  height: "string.integer.parse",
  round: "number",
  blockId: BlockId,
  signatures: CosmosCommitSigners,
});

const Tm2Commit = type({
  blockId: BlockId,
  precommits: Tm2Precommits,
});

const CosmosCommitExclusive = CosmosCommit.and(
  type({
    "precommits?": "never",
  }),
);

const Tm2CommitExclusive = Tm2Commit.and(
  type({
    "signatures?": "never",
  }),
);

const Header = type({
  // Cosmos and tm2 have a bit different response
  version: CosmosHeaderVersion.or(Tm2HeaderVersion),
  chainId: "string",
  height: "string.integer.parse",
  time: "string.date.iso",
  lastBlockId: BlockId,
  lastCommitHash: "string",
  dataHash: "string | null",
  validatorsHash: "string",
  nextValidatorsHash: "string",
  consensusHash: "string",
  appHash: "string",
  lastResultsHash: "string | null",
  "evidenceHash?": "string | null",
  proposerAddress: "string",
});

export const BlockCommitSchema = type({
  result: type({
    signedHeader: {
      header: Header,
      commit: CosmosCommitExclusive.or(Tm2CommitExclusive),
    },
    // VERY IMPORTANT!
    // Nodes take time to reach the consensus. They can technically reach it even when not
    // all of the votes have been recorded. So what this value does it tells the RPC to return
    // only fully committed blocks.
    "canonical?": "boolean",
  }),
});

export type RpcError = typeof RpcError.infer;
export type RpcStatusResponse = typeof RpcStatusSchema.infer;
export type BlockCommitResponse = typeof BlockCommitSchema.infer;
