import { ArkErrors } from "arktype";
import axios from "axios";
import camelcaseKeys from "camelcase-keys";
import type { Response } from "../response";
import {
  type NodeData,
  NodeInfo,
  NodeSyncInfo,
  SlashingParams,
  type SlashingParamsResponse,
  ValidatorData,
  type ValidatorDataResponse,
  ValSet,
  type ValSetDataResponse,
  ValSetError,
} from "./types";

export async function getValidatorData(
  api: string,
  timeout: number = 5000,
  valoperAddr: string,
  height?: number,
): Promise<Response<ValidatorDataResponse>> {
  const url = `${api}/cosmos/staking/v1beta1/validators/${valoperAddr}`;
  try {
    // Cosmos SDK's grpc-gateway honors this header to query state as of a past height, even on
    // endpoints (like this one) that don't accept a height query/path param directly.
    const response = await axios.get(url, {
      timeout,
      ...(height != null ? { headers: { "x-cosmos-block-height": String(height) } } : {}),
    });
    const data = camelcaseKeys(response.data, { deep: true });
    const result = ValidatorData(data);
    if (result instanceof ArkErrors) {
      return { ok: false, error: result.summary, problemsByPath: result.flatProblemsByPath };
    }
    return { ok: true, data: result };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function getSlashingParams(
  api: string,
  timeout: number = 5000,
): Promise<Response<SlashingParamsResponse>> {
  const url = `${api}/cosmos/slashing/v1beta1/params`;
  try {
    const response = await axios.get(url, { timeout });
    const data = camelcaseKeys(response.data, { deep: true });
    const result = SlashingParams(data);
    if (result instanceof ArkErrors) {
      return { ok: false, error: result.summary, problemsByPath: result.flatProblemsByPath };
    }
    return { ok: true, data: result };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function getStatus(api: string, timeout: number = 5000): Promise<Response<NodeData>> {
  const nodeUrl = `${api}/cosmos/base/tendermint/v1beta1/node_info`;
  const syncUrl = `${api}/cosmos/base/tendermint/v1beta1/syncing`;

  try {
    const [nodeResponse, syncResponse] = await Promise.all([
      axios.get(nodeUrl, { timeout }),
      axios.get(syncUrl, { timeout }),
    ]);
    const nodeData = camelcaseKeys(nodeResponse.data, { deep: true });
    const syncData = camelcaseKeys(syncResponse.data, { deep: true });
    const nodeResult = NodeInfo(nodeData);
    const syncResult = NodeSyncInfo(syncData);
    if (nodeResult instanceof ArkErrors) {
      return {
        ok: false,
        error: nodeResult?.summary,
        problemsByPath: nodeResult?.flatProblemsByPath,
      };
    }
    if (syncResult instanceof ArkErrors) {
      return {
        ok: false,
        error: syncResult?.summary,
        problemsByPath: syncResult?.flatProblemsByPath,
      };
    }
    return { ok: true, data: { nodeInfo: nodeResult, syncInfo: syncResult } };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function getValset(
  api: string,
  height: number,
  timeout: number = 5000,
  nextKey: string = "",
): Promise<Response<ValSetDataResponse>> {
  const url = `${api}/cosmos/base/tendermint/v1beta1/validatorsets/${height}`;
  const params = nextKey.length > 0 ? { "pagination.next_key": nextKey } : undefined;
  try {
    const response = await axios.get(url, { timeout, params });
    const data = camelcaseKeys(response.data, { deep: true });
    const result = ValSet(data);
    if (result instanceof ArkErrors) {
      const asError = ValSetError(data);
      if (asError instanceof ArkErrors) {
        return {
          ok: false,
          error: `Response matched neither ValSet nor a known error shape: ${result.summary}`,
          problemsByPath: result.flatProblemsByPath,
        };
      }
      return {
        ok: false,
        error: asError.message,
      };
    }
    return { ok: true, data: result };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
