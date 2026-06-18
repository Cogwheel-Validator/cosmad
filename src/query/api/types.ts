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
      p2p: "string.integer.parse",
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
