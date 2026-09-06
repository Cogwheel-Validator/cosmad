import { describe, expect, test, vi } from "vitest";
import type { ChainConfig } from "@/config/app_config";
import logger from "@/pkgs/logger";
import type { QueryOperator } from "@/query";
import type { BlockCommitResponse } from "@/query/rpc/types";
import { commitToBlock } from "../chain_worker";

const VALCONS_HEX = "8A948A32DC693745146C2CD913815B166675809B";
// Shared across both chain types' fixtures.
const OPERATOR_ADDRESS = "cosmosvaloper1test";
const SIGNER_ADDRESS = "cosmosvalcons1placeholder";
const FAKE_SIGNATURE =
  "VNMOnZJIFUcZmmBSdfewTpsdAnviEL4PMcc9qaiI/z1XdP2XR4ENAoD+L4hg1FmtzlLnBWoujeJ/bwKrp5+CBw==";

const chainLog = logger.child({ module: "test" });

const SHARED_ALERT_CONFIG = {
  alertIfInactive: false,
  signingWindowSize: 10,
  stalledAlert: { enabled: false, stalledThreshold: 60 },
  consecutiveMissAlert: { enabled: false, threshold: 3, repeat: false, repeatInterval: 0 },
  percentageMissedBlocksAlert: { enabled: false, threshold: 50, repeat: false },
};

function bftChain(): ChainConfig {
  return {
    chainId: "test-bft",
    prettyName: "Test BFT",
    chainType: "bft",
    valoperAddress: OPERATOR_ADDRESS,
    valconsAddress: SIGNER_ADDRESS,
    rpcUrls: [{ url: "https://rpc.test", alertIfDown: true }],
    alertConfig: SHARED_ALERT_CONFIG,
  };
}

function tm2Chain(): ChainConfig {
  return {
    chainId: "test-tm2",
    prettyName: "Test TM2",
    chainType: "tm2",
    operatorAddress: OPERATOR_ADDRESS,
    signingAddress: SIGNER_ADDRESS,
    rpcUrls: [{ url: "https://rpc.test", alertIfDown: true }],
    alertConfig: SHARED_ALERT_CONFIG,
  };
}

/** A query stub whose getValidatorData either resolves as active/inactive or throws if called
 * when the test expects the cached active set to short-circuit the lookup entirely. */
function queryStub(getValidatorData = vi.fn()): QueryOperator {
  return { getValidatorData } as unknown as QueryOperator;
}

function neverCalled(): QueryOperator {
  return queryStub(vi.fn().mockRejectedValue(new Error("should not have been called")));
}

function bftCommit(
  signatureValidatorAddress: string | null,
  blockIdFlag: number,
  height = 100,
): BlockCommitResponse {
  return {
    result: {
      signedHeader: {
        header: {
          version: { block: 11 },
          chainId: "test-bft",
          height,
          time: new Date().toISOString(),
          lastBlockId: { hash: "AA", parts: { total: 1, hash: "AA" } },
          lastCommitHash: "AA",
          dataHash: "AA",
          validatorsHash: "AA",
          nextValidatorsHash: "AA",
          consensusHash: "AA",
          appHash: "AA",
          lastResultsHash: "AA",
          proposerAddress: "AA",
        },
        commit: {
          height,
          round: 0,
          blockId: { hash: "BB", parts: { total: 1, hash: "BB" } },
          signatures:
            signatureValidatorAddress == null
              ? []
              : [
                  {
                    blockIdFlag,
                    validatorAddress: signatureValidatorAddress,
                    timestamp: new Date().toISOString(),
                    signature: blockIdFlag === 2 ? FAKE_SIGNATURE : null,
                  },
                ],
        },
      },
    },
  } as unknown as BlockCommitResponse;
}

function tm2Commit(precommitValidatorAddress: string | null, type: number): BlockCommitResponse {
  return {
    result: {
      signedHeader: {
        header: {
          version: "v1",
          chainId: "test-tm2",
          height: 100,
          time: new Date().toISOString(),
          lastBlockId: { hash: "AA", parts: { total: 1, hash: "AA" } },
          lastCommitHash: "AA",
          dataHash: "AA",
          validatorsHash: "AA",
          nextValidatorsHash: "AA",
          consensusHash: "AA",
          appHash: "AA",
          lastResultsHash: "AA",
          proposerAddress: "AA",
        },
        commit: {
          blockId: { hash: "BB", parts: { total: 1, hash: "BB" } },
          precommits:
            precommitValidatorAddress == null
              ? []
              : [
                  {
                    type,
                    height: 100,
                    blockId: { hash: "BB", parts: { total: 1, hash: "BB" } },
                    timestamp: new Date().toISOString(),
                    validatorAddress: precommitValidatorAddress,
                    signature: type === 2 ? FAKE_SIGNATURE : null,
                    validatorIndex: 0,
                  },
                ],
        },
      },
    },
  } as unknown as BlockCommitResponse;
}

describe("commitToBlock - bft: a present signature entry is definitive, no active-set check", () => {
  test("signature present, blockIdFlag=2 -> signed = 1, even if not in the cached active set", async () => {
    const commit = bftCommit(VALCONS_HEX, 2);
    const block = await commitToBlock(
      commit,
      bftChain(),
      VALCONS_HEX,
      new Set(), // deliberately empty - presence of a signature entry should still win
      neverCalled(),
      { value: undefined },
      chainLog,
    );
    expect(block.signed).toBe(1);
  });

  test("signature present, blockIdFlag != 2 -> signed = 0 (clear miss), no query needed", async () => {
    const commit = bftCommit(VALCONS_HEX, 1);
    const block = await commitToBlock(
      commit,
      bftChain(),
      VALCONS_HEX,
      undefined,
      neverCalled(),
      { value: undefined },
      chainLog,
    );
    expect(block.signed).toBe(0);
  });
});

describe("commitToBlock - bft: no signature entry, disambiguated via active-set membership", () => {
  test("validator is in the cached active set -> signed = 0, no query call", async () => {
    const commit = bftCommit(null, 2);
    const block = await commitToBlock(
      commit,
      bftChain(),
      VALCONS_HEX,
      new Set([VALCONS_HEX]),
      neverCalled(),
      { value: undefined },
      chainLog,
    );
    expect(block.signed).toBe(0);
  });

  test("not in cached active set, fallback validator lookup reports bonded+unjailed -> signed = 0", async () => {
    const getValidatorData = vi.fn().mockResolvedValue({
      ok: true,
      data: { validator: { jailed: false, status: "BOND_STATUS_BONDED" } },
    });
    const commit = bftCommit(null, 2, 42);
    const block = await commitToBlock(
      commit,
      bftChain(),
      VALCONS_HEX,
      new Set(), // cached set doesn't contain the validator
      queryStub(getValidatorData),
      { value: undefined },
      chainLog,
    );
    expect(block.signed).toBe(0);
    expect(getValidatorData).toHaveBeenCalledWith(OPERATOR_ADDRESS, 42);
  });

  test("not in cached active set, fallback validator lookup reports jailed -> signed = -1", async () => {
    const getValidatorData = vi.fn().mockResolvedValue({
      ok: true,
      data: { validator: { jailed: true, status: "BOND_STATUS_BONDED" } },
    });
    const commit = bftCommit(null, 2);
    const block = await commitToBlock(
      commit,
      bftChain(),
      VALCONS_HEX,
      undefined, // no cached active set at all (startup fetch failed)
      queryStub(getValidatorData),
      { value: undefined },
      chainLog,
    );
    expect(block.signed).toBe(-1);
  });

  test("fallback lookup failure assumes active (signed = 0) rather than false-flooding -1", async () => {
    const getValidatorData = vi.fn().mockResolvedValue({ ok: false, error: "network error" });
    const commit = bftCommit(null, 2);
    const block = await commitToBlock(
      commit,
      bftChain(),
      VALCONS_HEX,
      undefined,
      queryStub(getValidatorData),
      { value: undefined },
      chainLog,
    );
    expect(block.signed).toBe(0);
  });

  test("the fallback cache is memoized - a second ambiguous block reuses the first lookup", async () => {
    const getValidatorData = vi.fn().mockResolvedValue({
      ok: true,
      data: { validator: { jailed: false, status: "BOND_STATUS_BONDED" } },
    });
    const query = queryStub(getValidatorData);
    const cache = { value: undefined };

    await commitToBlock(
      bftCommit(null, 2, 10),
      bftChain(),
      VALCONS_HEX,
      new Set(),
      query,
      cache,
      chainLog,
    );
    await commitToBlock(
      bftCommit(null, 2, 11),
      bftChain(),
      VALCONS_HEX,
      new Set(),
      query,
      cache,
      chainLog,
    );

    expect(getValidatorData).toHaveBeenCalledTimes(1);
  });
});

describe("commitToBlock - tm2, no active-set option, never calls the query", () => {
  test("matching precommit with type=2 -> signed = 1", async () => {
    const commit = tm2Commit(SIGNER_ADDRESS, 2);
    const block = await commitToBlock(
      commit,
      tm2Chain(),
      undefined,
      undefined,
      neverCalled(),
      { value: undefined },
      chainLog,
    );
    expect(block.signed).toBe(1);
  });

  test("no matching precommit -> signed = 0, never -1", async () => {
    const commit = tm2Commit(null, 2);
    const block = await commitToBlock(
      commit,
      tm2Chain(),
      undefined,
      undefined,
      neverCalled(),
      { value: undefined },
      chainLog,
    );
    expect(block.signed).toBe(0);
  });
});
