import type { Response } from "../response";
import { getSigningInfo, getSlashingParams, getStatus, getValidatorData, getValset } from "./query";
import type {
  NodeData,
  SigningInfoResponse,
  SlashingParamsResponse,
  ValidatorDataResponse,
  ValSetDataResponse,
} from "./types";

// Cosmos API client.
export class ApiClient {
  readonly chainId: string;
  readonly apiUrls: string[];

  constructor(chainId: string, apiUrls: string[]) {
    this.chainId = chainId;
    this.apiUrls = Array<string>(apiUrls.length);

    for (let [i, url] of apiUrls.entries()) {
      url = url.trim(); // just to be sure
      if (url.endsWith("/")) {
        url = url.slice(0, -1);
      }
      this.apiUrls[i] = url;
    }
  }

  public get getId(): string {
    return this.chainId;
  }

  public get getApiUrls(): string[] {
    return this.apiUrls;
  }

  // Wraps the getValidatorData function.
  public async getValidatorData(
    url: string,
    valoperAddr: string,
    timeout?: number,
    height?: number,
  ): Promise<Response<ValidatorDataResponse>> {
    return getValidatorData(url, timeout, valoperAddr, height);
  }

  public async getSigningInfo(
    url: string,
    valconsAddr: string,
    timeout?: number,
    height?: number,
  ): Promise<Response<SigningInfoResponse>> {
    return getSigningInfo(url, timeout, valconsAddr, height);
  }

  public async getSlashingParams(
    url: string,
    timeout?: number,
  ): Promise<Response<SlashingParamsResponse>> {
    return getSlashingParams(url, timeout);
  }

  public async getStatus(url: string): Promise<Response<NodeData>> {
    return getStatus(url);
  }

  public async checkHealth(): Promise<{
    healthyRpcs: string[];
    unhealthyRpcs: string[];
    reasons: Map<string, string>;
  }> {
    const healthyRpcs: string[] = [];
    const unhealthyRpcs: string[] = [];
    const reasons = new Map<string, string>();
    const results = await Promise.all(
      this.apiUrls.map(async (url) => {
        const result = await getStatus(url);
        if (result.ok) {
          return { url, ok: result.ok, data: result.data };
        } else {
          return { url, ok: result.ok, error: result.error };
        }
      }),
    );

    for (const result of results) {
      if (!result.ok) {
        unhealthyRpcs.push(result.url);
        reasons.set(result.url, `unreachable: ${result.error ?? "unknown error"}`);
      } else if (result.data.nodeInfo.defaultNodeInfo.network !== this.chainId) {
        unhealthyRpcs.push(result.url);
        reasons.set(
          result.url,
          `wrong network ${result.data.nodeInfo.defaultNodeInfo.network} (expected ${this.chainId})`,
        );
      } else if (result.data.syncInfo.syncing !== false) {
        unhealthyRpcs.push(result.url);
        reasons.set(result.url, "node is still syncing");
      } else {
        healthyRpcs.push(result.url);
      }
    }

    return { healthyRpcs, unhealthyRpcs, reasons };
  }

  public async getValset(
    url: string,
    height: number,
    timeout: number = 5000,
    nextKey: string | undefined = undefined,
  ): Promise<Response<ValSetDataResponse>> {
    return getValset(url, height, timeout, nextKey);
  }
}
