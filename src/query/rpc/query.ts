import { ArkErrors } from "arktype";
import axios from "axios";
import camelcaseKeys from "camelcase-keys";
import type { Response } from "../response";
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

/**
 * Query the status of a Cosmos-based chain RPC endpoint.
 * @param rpcUrl - The URL of the RPC endpoint to query.
 * @returns A response containing the parsed status data if successful, or an error if not.
 */
export async function getStatus(
  rpcUrl: string,
  timeout: number = 5000,
): Promise<Response<RpcStatusResponse>> {
  const queryUrl = `${rpcUrl}/status`;
  try {
    const response = await axios.get(queryUrl, { timeout });
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
      return { ok: false, error: `Unknown error, ${error}` };
    }
  }
}

/**
 * Query the commit of a Cosmos-based chain RPC endpoint.
 * @param rpcUrl - The URL of the RPC endpoint to query.
 * @param height - The height to query the commit at.
 *   If not provided, the latest commit will be returned.
 * @returns A response containing the parsed commit data if successful, or an error if not.
 */
export async function getCommit(
  rpcUrl: string,
  timeout: number = 5000,
  height?: number,
): Promise<Response<BlockCommitResponse>> {
  const queryUrl = `${rpcUrl}/commit${height ? `?height=${height}` : ""}`;
  try {
    const response = await axios.get(queryUrl, { timeout });
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
