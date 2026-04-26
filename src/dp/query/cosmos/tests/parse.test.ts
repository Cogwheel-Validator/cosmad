import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ArkErrors } from "arktype";
import camelcaseKeys from "camelcase-keys";
import { describe, expect, test } from "vitest";
import { BlockCommitSchema, RpcStatusSchema } from "../types";

const testDataDir = join(import.meta.dirname, "test_data");
const status = JSON.parse(readFileSync(join(testDataDir, "test_status.json"), "utf8"));
const statusBad = JSON.parse(readFileSync(join(testDataDir, "bad_status.json"), "utf8"));
const commit = JSON.parse(readFileSync(join(testDataDir, "test_commit.json"), "utf8"));
const commitBad = JSON.parse(readFileSync(join(testDataDir, "bad_commit.json"), "utf8"));

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
