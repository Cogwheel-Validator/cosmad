import { ArkErrors } from "arktype";
import axios from "axios";
import camelcaseKeys from "camelcase-keys";
import type { Response } from "../types";
import {
  type BlockCommitResponse,
  BlockCommitSchema,
  type RpcStatusResponse,
  RpcStatusSchema,
} from "./types";

type RpcError = {
  message: string;
  code: number;
};

export async function getStatus(rpcUrl: string): Promise<Response<RpcStatusResponse>> {
  const queryUrl = `${rpcUrl}/status`;
  try {
    const response = await axios.get(queryUrl, { timeout: 5000 });
    const normalized = camelcaseKeys(response.data, { deep: true });
    const statusParsed = RpcStatusSchema(normalized);
    if (statusParsed instanceof ArkErrors) {
      return {
        ok: false,
        error: statusParsed.summary,
        problemsByPath: statusParsed.flatProblemsByPath,
      };
    }
    return { ok: true, data: statusParsed as RpcStatusResponse };
  } catch (error) {
    if (axios.isAxiosError<RpcError>(error)) {
      return {
        ok: false,
        error: `
        Code: ${error.code ?? "unknown"}, 
        reason: ${error.message}, 
        http status: ${error.response?.status}, 
        url: ${error.config?.url}, 
        ${error.config?.url}`,
      };
    } else {
      return { ok: false, error: "Unknown error while querying RPC status" };
    }
  }
}

export async function getCommit(
  rpcUrl: string,
  height?: number,
): Promise<Response<BlockCommitResponse>> {
  const queryUrl = `${rpcUrl}/commit${height ? `?height=${height}` : ""}`;
  try {
    const response = await axios.get(queryUrl, { timeout: 5000 });
    const normalized = camelcaseKeys(response.data, { deep: true });
    const commitParsed = BlockCommitSchema(normalized);
    if (commitParsed instanceof ArkErrors) {
      return {
        ok: false,
        error: commitParsed.summary,
        problemsByPath: commitParsed.flatProblemsByPath,
      };
    }
    return { ok: true, data: commitParsed as BlockCommitResponse };
  } catch (error) {
    if (axios.isAxiosError<RpcError>(error)) {
      return {
        ok: false,
        error: `
        Code: ${error.code ?? "unknown"}, 
        reason: ${error.message}, 
        http status: ${error.response?.status}, 
        url: ${error.config?.url}`,
      };
    } else {
      return { ok: false, error: "Unknown error while querying RPC commit" };
    }
  }
}
