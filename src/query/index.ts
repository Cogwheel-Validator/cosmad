import { ApiClient } from "./api/client";
import type {
  SigningInfoResponse,
  SlashingParamsResponse,
  ValidatorDataResponse,
  ValSetDataResponse,
} from "./api/types";
import type { Response } from "./response";
import { RpcClient } from "./rpc/client";
import type { BlockCommitResponse } from "./rpc/types";

/** Health of one configured endpoint as of the last health check. */
export interface EndpointHealth {
  url: string;
  healthy: boolean;
  /** Why the endpoint is unhealthy (unreachable, wrong network, syncing, lagging behind). */
  reason?: string;
}

export class QueryOperator {
  private static readonly DEFAULT_RANGE_CHUNK_SIZE = 25;
  private healthyApis: string[] = [];
  private unhealthyApis: string[] = [];
  private apiUnhealthyReasons = new Map<string, string>();
  private rpcUnhealthyReasons = new Map<string, string>();
  private apiClient: ApiClient | undefined;
  private apiIndex = 0;

  private healthyRpcs: string[] = [];
  private unhealthyRpcs: string[] = [];
  private rpcClient: RpcClient;
  private rpcIndex = 0;

  private chainId: string;
  private chainType: "bft" | "tm2";

  private healthCheckInterval: number; // seconds
  private lastRpcHealthCheckTime: number = 0;
  private lastApiHealthCheckTime: number = 0;
  private retryAttempts: number;
  private rangeChunkSize: number;

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
    rangeChunkSize: number = QueryOperator.DEFAULT_RANGE_CHUNK_SIZE,
  ) {
    this.chainId = chainId;
    this.chainType = chainType;
    this.rpcClient = new RpcClient(rpcUrls, chainId, chainType);
    if (chainType === "bft" && apiUrls && apiUrls.length > 0) {
      this.apiClient = new ApiClient(chainId, apiUrls);
    }
    this.healthCheckInterval = healthCheckInterval;
    this.retryAttempts = retryAttempts;
    this.rangeChunkSize = rangeChunkSize;
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
    const { healthyRpcs, unhealthyRpcs, reasons } = await this.rpcClient.checkHealth();
    this.healthyRpcs = healthyRpcs;
    this.unhealthyRpcs = unhealthyRpcs;
    this.rpcUnhealthyReasons = reasons;
    this.lastRpcHealthCheckTime = Date.now();
  }

  private async runApiHealthCheck(): Promise<void> {
    if (!this.apiClient) return;
    const { healthyRpcs, unhealthyRpcs, reasons } = await this.apiClient.checkHealth();
    this.healthyApis = healthyRpcs;
    this.unhealthyApis = unhealthyRpcs;
    this.apiUnhealthyReasons = reasons;
    this.lastApiHealthCheckTime = Date.now();
  }

  /**
   * Health of every configured endpoint as of the most recent health check. Health checks run
   * lazily as part of normal querying (at most every healthCheckInterval seconds, or on every
   * request while no endpoint is healthy). `rpc`/`api` are undefined until their first check
   * has run, so "not checked yet" is never mistaken for "down".
   */
  public endpointHealth(): { rpc?: EndpointHealth[]; api?: EndpointHealth[] } {
    const snapshot = (
      urls: string[],
      healthy: string[],
      reasons: Map<string, string>,
    ): EndpointHealth[] =>
      urls.map((url) => {
        if (healthy.includes(url)) return { url, healthy: true };
        return { url, healthy: false, reason: reasons.get(url) ?? "unhealthy" };
      });
    return {
      ...(this.lastRpcHealthCheckTime > 0
        ? {
            rpc: snapshot(this.rpcClient.rpcUrls, this.healthyRpcs, this.rpcUnhealthyReasons),
          }
        : {}),
      ...(this.apiClient != null && this.lastApiHealthCheckTime > 0
        ? {
            api: snapshot(this.apiClient.apiUrls, this.healthyApis, this.apiUnhealthyReasons),
          }
        : {}),
    };
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
    const url = this.healthyRpcs[this.rpcIndex++ % this.healthyRpcs.length];
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
    const url = this.healthyApis[this.apiIndex++ % this.healthyApis.length];
    if (!url) throw new Error(`No healthy API endpoints available for chain ${this.chainId}`);
    return url;
  }

  // Retries fn up to retryAttempts times with exponential backoff (100ms, 200ms, 400ms...).
  // fn (or getHealthyRpc/getHealthyApi called inside it) can throw rather than resolve to
  // {ok:false} - e.g. "No healthy RPC endpoints available" - so those throws are caught here
  // and treated as a failed attempt too. Without this, a fully-unhealthy RPC set would reject
  // the returned promise instead of resolving to Response<T>, breaking every caller's `.ok`
  // check and escaping as an unhandled rejection (previously this crashed the whole ingestion
  // process - and every other chain's worker with it - the moment one chain's RPCs went down).
  private async withRetry<T>(fn: () => Promise<Response<T>>): Promise<Response<T>> {
    let lastResult: Response<T> = { ok: false, error: "No attempts made" };
    for (let attempt = 0; attempt < this.retryAttempts; attempt++) {
      if (attempt > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, 100 * 2 ** (attempt - 1)));
      }
      try {
        lastResult = await fn();
      } catch (err) {
        lastResult = { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
      if (lastResult.ok) return lastResult;
    }
    return lastResult;
  }

  /**
   * Returns commits for a given range of block heights [from, to).
   * Requests are batched sequentially in chunks of `rangeChunkSize`, each chunk run
   * concurrently - so only one chunk's worth of requests is ever in flight.
   * @param from - The starting block height (inclusive).
   * @param to - The ending block height (exclusive).
   * @returns A promise that resolves to an array of commit responses.
   */
  public async getRangeCommits(from: number, to: number): Promise<Response<BlockCommitResponse>[]> {
    const heights = Array.from({ length: to - from }, (_, i) => from + i);
    const results: Response<BlockCommitResponse>[] = [];
    for (let i = 0; i < heights.length; i += this.rangeChunkSize) {
      const chunk = heights.slice(i, i + this.rangeChunkSize);
      const settled = await Promise.allSettled(
        chunk.map((height) =>
          this.withRetry(async () => {
            const rpc = await this.getHealthyRpc();
            return this.rpcClient.getCommit(rpc, height);
          }),
        ),
      );
      results.push(
        ...settled.map((s) =>
          s.status === "fulfilled"
            ? s.value
            : {
                ok: false as const,
                error: s.reason instanceof Error ? s.reason.message : String(s.reason),
              },
        ),
      );
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

  /**
   * Retrieves validator data for a given validator address, optionally at a specific height.
   * @param valoperAddr - The validator address to retrieve data for.
   * @param height optional - sent via the x-cosmos-block-height header to query state as of a
   * @returns A promise that resolves to the validator data response.
   */
  public async getValidatorData(
    valoperAddr: string,
    height?: number,
  ): Promise<Response<ValidatorDataResponse>> {
    if (this.chainType === "tm2")
      return { ok: false, error: `Unsupported method for tm2 on ${this.chainId}` };
    if (this.apiClient === undefined) return { ok: false, error: "No API client available" };
    const client = this.apiClient;
    return this.withRetry(async () => {
      const apiUrl = await this.getHealthyApi();
      return client.getValidatorData(apiUrl, valoperAddr, undefined, height);
    });
  }

  /**
   * Retrieves the slashing signing info (jailed until, tombstoned) of a validator.
   * @param valconsAddr bech32 consensus address of the validator.
   * @param height optional - query state as of this height (x-cosmos-block-height header).
   */
  public async getSigningInfo(
    valconsAddr: string,
    height?: number,
  ): Promise<Response<SigningInfoResponse>> {
    if (this.chainType === "tm2")
      return { ok: false, error: `Unsupported method for tm2 on ${this.chainId}` };
    if (this.apiClient === undefined) return { ok: false, error: "No API client available" };
    const client = this.apiClient;
    return this.withRetry(async () => {
      const apiUrl = await this.getHealthyApi();
      return client.getSigningInfo(apiUrl, valconsAddr, undefined, height);
    });
  }

  // Returns the slashing parameters for the chain.
  // @returns A promise that resolves to the slashing parameters response.
  public async getSlashingParams(): Promise<Response<SlashingParamsResponse>> {
    if (this.chainType === "tm2")
      return { ok: false, error: `Unsupported method for tm2 on ${this.chainId}` };
    if (this.apiClient === undefined) return { ok: false, error: "No API client available" };
    const client = this.apiClient;
    return this.withRetry(async () => {
      const apiUrl = await this.getHealthyApi();
      return client.getSlashingParams(apiUrl);
    });
  }

  /**
   * Retrieves the validator set for a given height.
   * @param height - Block height which will be used in the query.
   * @param timeout - Timeout in milliseconds for the request. Defaults to 5000ms.
   * @returns A promise that resolves to the validator set response.
   */
  public async getValset(
    height: number,
    timeout: number = 5000,
  ): Promise<Response<ValSetDataResponse>> {
    if (this.apiClient === undefined) return { ok: false, error: "No API client available" };
    const client = this.apiClient;
    let nextKey: string = "";
    let validatorSet: ValSetDataResponse | undefined;
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

      nextKey = validatorSet.pagination.nextKey ?? "";
    } while (nextKey !== "");
    return { ok: true, data: validatorSet! };
  }
}
