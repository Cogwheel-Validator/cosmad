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

const CommitSigners = type({
  blockIdFlag: "0 <= number <= 3",
  validatorAddress: "string.alphanumeric == 40 | string == 0",
  timestamp: "string.date.iso",
  signature: "string.base64 == 88| null",
});

const Header = type({
  version: {
    block: "string.integer",
  },
  chainId: "string",
  height: "string.integer",
  time: "string.date.iso",
  lastBlockId: {
    hash: "string",
    parts: {
      total: "number",
      hash: "string",
    },
  },
  lastCommitHash: "string",
  dataHash: "string",
  validatorsHash: "string",
  nextValidatorsHash: "string",
  consensusHash: "string",
  appHash: "string",
  lastResultsHash: "string",
  evidenceHash: "string",
  proposerAddress: "string",
});

const BlockCommit = type({
  signedHeader: {
    header: Header,
    commit: {
      height: "string.integer",
      round: "number",
      signatures: CommitSigners.array(),
    },
  },
});

export const BlockCommitSchema = RpcResponse.and({
  result: BlockCommit,
});

export type RpcError = typeof RpcError.infer;
export type RpcStatusResponse = typeof RpcStatusSchema.infer;
export type BlockCommitResponse = typeof BlockCommitSchema.infer;
