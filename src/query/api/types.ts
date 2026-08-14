import { type } from "arktype";

export const ValidatorData = type({
  validator: type({
    operatorAddress: "string",
    consensusPubkey: type({
      typeUrl: "string",
      value: "string",
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

export const ValSet = type({
  blockHeight: "string",
  validators: [
    {
      address: "string",
      pubKey: {
        typeUrl: "string",
        value: "string",
      },
      votingPower: "string",
      proposerPriority: "string"
    }
  ],
  pagination: {
    nextKey: "string",
    total: "string",
  }
});

export type ValSetDataResponse = typeof ValSet.infer;

export const ValSetError = type({
  error: "string",
  code: "number",
  message: "string",
  details: type({
    typeUrl: "string",
    value: "string",
  }).array(),
});

export type ValSetErrorResponse = typeof ValSetError.infer;
