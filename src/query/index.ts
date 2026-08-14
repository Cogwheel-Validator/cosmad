import { ApiClient } from "./api/client";
import type { ValidatorDataResponse, ValSetDataResponse } from "./api/types";
import type { Response } from "./response";
import { RpcClient } from "./rpc/client";
import type { BlockCommitResponse } from "./rpc/types";

export class QueryOperator {
  private healthyApis: string[] = [];
  private unhealthyApis: string[] = [];
  private apiClient: ApiClient | undefined;

  private healthyRpcs: string[] = [];
  private unhealthyRpcs: string[] = [];
  private rpcClient: RpcClient;

  private chainId: string;
  private chainType: "bft" | "tm2";

  private healthCheckInterval: number; // seconds
  private lastRpcHealthCheckTime: number = 0;
  private lastApiHealthCheckTime: number = 0;
  private retryAttempts: number;

  // Coalesce concurrent health check calls into one in-flight promise.
  private rpcHealthCheckInFlight: Promise<void> | null = null;
  private apiHealthCheckInFlight: Promise<void> | null = null;

  constructor(
    chainId: string,
    chainType: "bft" | "tm2",
    rpcUrls: string[],
    apiUrls?: string[],
    healthCheckInterval: number = 60,
    retryAttempts: number = 5,
  ) {
    this.chainId = chainId;
    this.chainType = chainType;
    this.rpcClient = new RpcClient(rpcUrls, chainId, chainType);
    if (chainType === "bft" && apiUrls && apiUrls.length > 0) {
      this.apiClient = new ApiClient(chainId, apiUrls);
    }
    this.healthCheckInterval = healthCheckInterval;
    this.retryAttempts = retryAttempts;
  }

  // Returns the list of healthy RPC URLs.
  public get hApis(): string[] {
    return this.healthyApis;
  }

  // Returns the list of unhealthy RPC URLs.
  public get uApis(): string[] {
    return this.unhealthyApis;
  }

  public get hRpcs(): string[] {
    return this.healthyRpcs;
  }

  public get uRpcs(): string[] {
    return this.unhealthyRpcs;
  }

  private async runRpcHealthCheck(): Promise<void> {
    const { healthyRpcs, unhealthyRpcs } = await this.rpcClient.checkHealth();
    this.healthyRpcs = healthyRpcs;
    this.unhealthyRpcs = unhealthyRpcs;
    this.lastRpcHealthCheckTime = Date.now();
  }

  private async runApiHealthCheck(): Promise<void> {
    if (!this.apiClient) return;
    const { healthyRpcs, unhealthyRpcs } = await this.apiClient.checkHealth();
    this.healthyApis = healthyRpcs;
    this.unhealthyApis = unhealthyRpcs;
    this.lastApiHealthCheckTime = Date.now();
  }

  private async getHealthyRpc(): Promise<string> {
    const isStale = Date.now() - this.lastRpcHealthCheckTime > this.healthCheckInterval * 1000;
    if (isStale || this.healthyRpcs.length === 0) {
      if (!this.rpcHealthCheckInFlight) {
        this.rpcHealthCheckInFlight = this.runRpcHealthCheck().finally(() => {
          this.rpcHealthCheckInFlight = null;
        });
      }
      await this.rpcHealthCheckInFlight;
    }
    const url = this.healthyRpcs[Math.floor(Math.random() * this.healthyRpcs.length)];
    if (!url) throw new Error(`No healthy RPC endpoints available for chain ${this.chainId}`);
    return url;
  }

  private async getHealthyApi(): Promise<string> {
    if (!this.apiClient)
      throw new Error(`API client not available for chain ${this.chainId} (tm2)`);
    const isStale = Date.now() - this.lastApiHealthCheckTime > this.healthCheckInterval * 1000;
    if (isStale || this.healthyApis.length === 0) {
      if (!this.apiHealthCheckInFlight) {
        this.apiHealthCheckInFlight = this.runApiHealthCheck().finally(() => {
          this.apiHealthCheckInFlight = null;
        });
      }
      await this.apiHealthCheckInFlight;
    }
    const url = this.healthyApis[Math.floor(Math.random() * this.healthyApis.length)];
    if (!url) throw new Error(`No healthy API endpoints available for chain ${this.chainId}`);
    return url;
  }

  // Retries fn up to retryAttempts times with exponential backoff (100ms, 200ms, 400ms...).
  private async withRetry<T>(fn: () => Promise<Response<T>>): Promise<Response<T>> {
    let lastResult: Response<T> = { ok: false, error: "No attempts made" };
    for (let attempt = 0; attempt < this.retryAttempts; attempt++) {
      if (attempt > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, 100 * 2 ** (attempt - 1)));
      }
      lastResult = await fn();
      if (lastResult.ok) return lastResult;
    }
    return lastResult;
  }

  // Max number of commit requests in flight at once for a single getRangeCommits call, so a
  // large gap (e.g. after downtime) doesn't fire hundreds of concurrent requests at the RPCs.
  private static readonly RANGE_CHUNK_SIZE = 25;

  /**
   * Returns commits for a given range of block heights [from, to).
   * Requests are batched in chunks of RANGE_CHUNK_SIZE run concurrently; each individual
   * commit retries independently. Results are returned in height order.
   */
  public async getRangeCommits(from: number, to: number): Promise<Response<BlockCommitResponse>[]> {
    const heights = Array.from({ length: to - from }, (_, i) => from + i);
    const results: Response<BlockCommitResponse>[] = [];
    for (let i = 0; i < heights.length; i += QueryOperator.RANGE_CHUNK_SIZE) {
      const chunk = heights.slice(i, i + QueryOperator.RANGE_CHUNK_SIZE);
      const chunkResults = await Promise.all(
        chunk.map((height) =>
          this.withRetry(async () => {
            const rpc = await this.getHealthyRpc();
            return this.rpcClient.getCommit(rpc, height);
          }),
        ),
      );
      results.push(...chunkResults);
    }
    return results;
  }

  public async getLatestCommit(): Promise<Response<BlockCommitResponse>> {
    const client = this.rpcClient;
    return this.withRetry(async () => {
      const rpc = await this.getHealthyRpc();
      return client.getCommit(rpc);
    });
  }

  public async getValidatorData(valoperAddr: string): Promise<Response<ValidatorDataResponse>> {
    if (this.chainType === "tm2")
      return { ok: false, error: `Unsupported method for tm2 on ${this.chainId}` };
    if (this.apiClient === undefined) return { ok: false, error: "No API client available" };
    const client = this.apiClient;
    return this.withRetry(async () => {
      const apiUrl = await this.getHealthyApi();
      return client.getValidatorData(apiUrl, valoperAddr);
    });
  }

  public async getValset(
    height: number,
    timeout: number = 5000,
  ): Promise<Response<ValSetDataResponse>> {
    if (this.apiClient === undefined) return { ok: false, error: "No API client available" };
    const client = this.apiClient;
    let nextKey: string = "";
    let validatorSet: ValSetDataResponse | undefined = undefined;
    do {
      const key = nextKey;
      const response = await this.withRetry(async () => {
        const apiUrl = await this.getHealthyApi();
        return client.getValset(apiUrl, height, timeout, key);
      });
      if (!response.ok) return response;
      if (validatorSet === undefined) {
        validatorSet = response.data;
      } else {
        validatorSet.validators.push(...response.data.validators);
      }

      nextKey = validatorSet.pagination.nextKey;
    } while (nextKey !== "");
    return { ok: true, data: validatorSet! };
  }
}
