import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AxiosResponse } from "axios";
import axios from "axios";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { getCommit, getStatus } from "../universal_rpc_query";

vi.mock("axios");

function axiosOk<T>(data: T): AxiosResponse<T> {
  // `query.ts` only reads `response.data`, so we keep the mock minimal.
  return { data } as unknown as AxiosResponse<T>;
}

function axiosErr(params: { message: string; code?: string; url?: string; status?: number }) {
  return {
    isAxiosError: true,
    message: params.message,
    code: params.code,
    config: { url: params.url },
    response: params.status ? { status: params.status } : undefined,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  // Because `axios` is module-mocked, we need to define how Axios errors are detected.
  vi.mocked(axios.isAxiosError).mockImplementation((err): err is unknown => {
    if (typeof err !== "object" || err === null) return false;
    return (err as Record<string, unknown>).isAxiosError === true;
  });
});

const testDataDir = join(import.meta.dirname, "test_data");
const statusRaw = JSON.parse(readFileSync(join(testDataDir, "test_status.json"), "utf8"));
const commitRaw = JSON.parse(readFileSync(join(testDataDir, "test_commit.json"), "utf8"));
const statusBadRaw = JSON.parse(readFileSync(join(testDataDir, "bad_status.json"), "utf8"));
const commitBadRaw = JSON.parse(readFileSync(join(testDataDir, "bad_commit.json"), "utf8"));

describe("cosmos query", () => {
  test("getStatus returns parsed data", async () => {
    vi.mocked(axios.get).mockResolvedValue(axiosOk(statusRaw));

    const res = await getStatus("https://rpc.example");

    expect(res.ok).toBe(true);
    expect(res.data).toBeDefined();
    expect(res.data?.result.syncInfo.latestBlockTime).toBeInstanceOf(Date);
    expect(vi.mocked(axios.get)).toHaveBeenCalledWith("https://rpc.example/status", {
      timeout: 5000,
    });
  });

  test("getCommit returns parsed data", async () => {
    vi.mocked(axios.get).mockResolvedValue(axiosOk(commitRaw));

    const res = await getCommit("https://rpc.example", 8259656);

    expect(res.ok).toBe(true);
    expect(res.data).toBeDefined();
    expect(vi.mocked(axios.get)).toHaveBeenCalledWith("https://rpc.example/commit?height=8259656", {
      timeout: 5000,
    });
  });

  test("getStatus timed out", async () => {
    vi.mocked(axios.get).mockRejectedValue(
      axiosErr({ message: "Timeout", code: "ECONNABORTED", url: "https://rpc.example/status" }),
    );

    const res = await getStatus("https://rpc.example");

    expect(res.ok).toBe(false);
    expect(res.error).toContain("ECONNABORTED");
    expect(res.error).toContain("Timeout");
  });

  test("getCommit timed out", async () => {
    vi.mocked(axios.get).mockRejectedValue(
      axiosErr({
        message: "Timeout",
        code: "ECONNABORTED",
        url: "https://rpc.example/commit?height=8259656",
      }),
    );

    const res = await getCommit("https://rpc.example", 8259656);

    expect(res.ok).toBe(false);
    expect(res.error).toContain("ECONNABORTED");
    expect(res.error).toContain("Timeout");
  });

  test("getStatus Axios error", async () => {
    vi.mocked(axios.get).mockRejectedValue(
      axiosErr({ message: "Error", code: "ECONNREFUSED", url: "https://rpc.example/status" }),
    );

    const res = await getStatus("https://rpc.example");

    expect(res.ok).toBe(false);
    expect(res.error).toContain("ECONNREFUSED");
  });

  test("getCommit Axios error", async () => {
    vi.mocked(axios.get).mockRejectedValue(
      axiosErr({
        message: "Error",
        code: "ECONNREFUSED",
        url: "https://rpc.example/commit?height=8259656",
      }),
    );

    const res = await getCommit("https://rpc.example", 8259656);

    expect(res.ok).toBe(false);
    expect(res.error).toContain("ECONNREFUSED");
  });

  test("getStatus ArkType error", async () => {
    vi.mocked(axios.get).mockResolvedValue(axiosOk(statusBadRaw));

    const res = await getStatus("https://rpc.example");

    expect(res.ok).toBe(false);
    expect(res.error).toBeTruthy();
    expect(res.problemsByPath).toBeDefined();
  });

  test("getCommit ArkType error", async () => {
    vi.mocked(axios.get).mockResolvedValue(axiosOk(commitBadRaw));

    const res = await getCommit("https://rpc.example", 8259656);

    expect(res.ok).toBe(false);
    expect(res.error).toBeTruthy();
    expect(res.problemsByPath).toBeDefined();
  });
});
