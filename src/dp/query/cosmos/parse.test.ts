import { ArkErrors } from "arktype";
import camelcaseKeys from "camelcase-keys";
import { describe, expect, test } from "vitest";
import { BlockCommitSchema, RpcStatusSchema } from "./types";

const status = {
  jsonrpc: "2.0",
  id: -1,
  result: {
    node_info: {
      protocol_version: {
        p2p: "8",
        block: "11",
        app: "0",
      },
      id: "82947ebad484b4c3d7429c34561689e23d35f779",
      listen_addr: "tcp://0.0.0.0:14656",
      network: "atomone-1",
      version: "0.37.16",
      channels: "40202122233038606100",
      moniker: "Cogwheel",
      other: {
        tx_index: "on",
        rpc_address: "tcp://127.0.0.1:14657",
      },
    },
    sync_info: {
      latest_block_hash: "9B9668E749E3E6727D27053D1FF3CCA8DE6F188E978D90AD20748F5F9B38E786",
      latest_app_hash: "C831F0026EA6BCAF754C62F04454286EA3D29C2E4E4D97FA339944105056EB8F",
      latest_block_height: "8251317",
      latest_block_time: "2026-04-25T19:57:18.465771032Z",
      earliest_block_hash: "321EED7A75890AB6AB698AF68FEAEE64EB8CBA06BA4BC49165CD8C958B3745D0",
      earliest_app_hash: "C35246109E44729ABEB28DFFE85E3949F6BDDB268B0FD04C3604844C0E563011",
      earliest_block_height: "7604001",
      earliest_block_time: "2026-03-13T08:53:20.720479201Z",
      catching_up: false,
    },
  },
};

const statusBad = {
  jsonrpc: "2.0",
  id: -1,
  result: {
    node_info: {
      protocol_version: {
        p2p: "8",
        block: "11",
        app: "0",
      },
    },
  },
};

const commit = {
  jsonrpc: "2.0",
  id: -1,
  result: {
    signed_header: {
      header: {
        version: {
          block: "11",
        },
        chain_id: "atomone-1",
        height: "8259656",
        time: "2026-04-26T09:25:54.017930589Z",
        last_block_id: {
          hash: "98DAF6A22693B82B3ED30602CA700A25F305189ED16E2CA2F18F3F6C3F835221",
          parts: {
            total: 1,
            hash: "7AFB0E96915442B6D9F1D2E9DD82F4B1EF8D386635840B017DD8B076ECD79450",
          },
        },
        last_commit_hash: "65FDFFA8D53E949BF235BB66FF4046939E2E0F9CFB02F3BA3CBBE2E0BD032594",
        data_hash: "E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855",
        validators_hash: "68D8FB2ED6515EE439669E87763A65E97F4527CB502E79DB2FF8577DED6B191E",
        next_validators_hash: "68D8FB2ED6515EE439669E87763A65E97F4527CB502E79DB2FF8577DED6B191E",
        consensus_hash: "0C71A481C6151E5FE9DF617F5E8374F61A49EA07885794EEA940ADFD2993D9FE",
        app_hash: "EDA218F6A33ADC195A01C2C3EFB7C6A883A5CF72D85B9A542D86CBC3FD52594D",
        last_results_hash: "E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855",
        evidence_hash: "E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855",
        proposer_address: "4612B3B369C371B1A585C3E131259D98FE64E04F",
      },
      commit: {
        height: "8259656",
        round: 0,
        block_id: {
          hash: "A7034737BE23F4DBE7C33E47F22D7504F62FE987770E3111FA7460F12BAE56C9",
          parts: {
            total: 1,
            hash: "91198D1842324756D47D4D45DB324750FCEA86C5F27310875C17CDEF4BABCAE1",
          },
        },
        signatures: [
          {
            block_id_flag: 2,
            validator_address: "53BD95F452781E263D580AF4D5FE448D9C9267D3",
            timestamp: "2026-04-26T09:25:59.793559809Z",
            signature:
              "VNMOnZJIFUcZmmBSdfewTpsdAnviEL4PMcc9qaiI/z1XdP2XR4ENAoD+L4hg1FmtzlLnBWoujeJ/bwKrp5+CBw==",
          },
          {
            block_id_flag: 2,
            validator_address: "8A948A32DC693745146C2CD913815B166675809B",
            timestamp: "2026-04-26T11:40:44.176487748Z",
            signature:
              "g+jSfzMtdzYKaS8AbSeb6ChwY4ulI4ZHMIueXXHyT+fcgD4CsLxJFvIUMopFaToBFo09FA00DpeX/FdFiPcRCg==",
          },
          {
            block_id_flag: 2,
            validator_address: "1AEA7769C895F160AE7ADF9A4302CA20D396D9E5",
            timestamp: "2026-04-26T09:25:59.846940472Z",
            signature:
              "wViXzdW7s4ZEKuZY7j1zLx8DBR9sX+VJWwGfeR1Y9L5R3Rk8IbZd4bCh5PatG3tf++ytXmv89mRWUzEPO06ECQ==",
          },
          {
            block_id_flag: 1,
            validator_address: "",
            timestamp: "0001-01-01T00:00:00Z",
            signature: null,
          },
          {
            block_id_flag: 1,
            validator_address: "",
            timestamp: "0001-01-01T00:00:00Z",
            signature: null,
          },
        ],
      },
    },
  },
};

const commitBad = {
  jsonrpc: "2.0",
  id: -1,
  signed_header: {
    header: {
      version: {
        block: "11",
      },
      chain_id: "atomone-1",
      height: "8259656",
    },
  },
};

describe("Rpc status", () => {
  test("Parse Rpc status", () => {
    const normalized = camelcaseKeys(status, { deep: true });
    const statusParsed = RpcStatusSchema.assert(normalized);

    expect(normalized.result.nodeInfo.network).toBe(statusParsed.result.nodeInfo.network);
    expect(normalized.result.nodeInfo.version).toBe(statusParsed.result.nodeInfo.version);
    expect(normalized.result.syncInfo.catchingUp).toBe(statusParsed.result.syncInfo.catchingUp);
  });

  test("Fail parsing", () => {
    const normalized = camelcaseKeys(statusBad, { deep: true });
    const statusParsed = RpcStatusSchema(normalized);

    expect(statusParsed).toBeInstanceOf(ArkErrors);
  });
});

describe("Block commit", () => {
  test("Parse commit", () => {
    const normalized = camelcaseKeys(commit, { deep: true });
    const commitParsed = BlockCommitSchema.assert(normalized);

    expect(normalized.result).toMatchObject(commitParsed.result);
    expect(normalized.result.signedHeader.commit.signatures.length).toEqual(
      commitParsed.result?.signedHeader.commit.signatures.length,
    );
  });

  test("Fail pasring commit", () => {
    const normalized = camelcaseKeys(commitBad, { deep: true });
    const commitParsed = BlockCommitSchema(normalized);
    expect(commitParsed).toBeInstanceOf(ArkErrors);
  });
});
