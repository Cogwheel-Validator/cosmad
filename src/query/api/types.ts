import { type } from "arktype";

export const ValidatorData = type({
  validator: type({
    operatorAddress: "string",
    // grpc-gateway JSON-encodes Any as {"@type": "...", key: "..."} (Amino-style), not the
    // protobufjs {typeUrl, value} shape — and "@type" isn't snake_case so camelcaseKeys leaves
    // it untouched.
    consensusPubkey: type({
      "@type": "string",
      key: "string",
    }),
    jailed: "boolean",
    status: "string",
    tokens: "string",
    delegatorShares: "string",
    description: type({
      moniker: "string",
      identity: "string",
      website: "string",
      securityContact: "string",
      details: "string",
    }),
    unbondingHeight: "string",
    unbondingTime: "string",
    commission: type({
      commissionRates: type({
        rate: "string",
        maxRate: "string",
        maxChangeRate: "string",
      }),
      updateTime: "string",
    }),
    minSelfDelegation: "string",
    unbondingOnHoldRefCount: "string",
    unbondingIds: type.string.array(),
  }),
});

export const NodeInfo = type({
  defaultNodeInfo: type({
    protocolVersion: type({
      p2P: "string.integer.parse",
      block: "string.integer.parse",
      app: "string.integer.parse",
    }),
    network: "string",
    // other stuff is omitted
  }),
});

export const NodeSyncInfo = type({
  syncing: "boolean",
});

export type NodeData = {
  nodeInfo: typeof NodeInfo.infer;
  syncInfo: typeof NodeSyncInfo.infer;
};

export type ValidatorDataResponse = typeof ValidatorData.infer;

export const SlashingParams = type({
  params: type({
    signedBlocksWindow: "string.integer.parse",
    minSignedPerWindow: "string",
    downtimeJailDuration: "string",
    slashFractionDoubleSign: "string",
    slashFractionDowntime: "string",
  }),
});

export type SlashingParamsResponse = typeof SlashingParams.infer;

const ValSetValidator = type({
  address: "string",
  pubKey: type({
    "@type": "string",
    key: "string",
  }),
  votingPower: "string",
  proposerPriority: "string",
});

export const ValSet = type({
  blockHeight: "string",
  validators: ValSetValidator.array(),
  pagination: {
    nextKey: "string | null",
    total: "string",
  },
});

export type ValSetDataResponse = typeof ValSet.infer;

// grpc-gateway error responses vary by version/endpoint — commonly {code, message, details},
// with the legacy top-level "error" string field frequently absent. Keep this permissive so a
// real error response doesn't itself fail to parse.
export const ValSetError = type({
  code: "number",
  message: "string",
  "error?": "string",
  "details?": "unknown[]",
});

export type ValSetErrorResponse = typeof ValSetError.infer;
