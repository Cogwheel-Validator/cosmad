import type { Response } from "../response";
import { getCommit, getStatus } from "./universal_rpc_query";
import type { BlockCommitResponse, RpcStatusResponse } from "./universal_types";

const MAX_HEIGHT_DIFFERENCE = 20;

// Minimalistic RPC client.
export class RpcClient {
  readonly chainId: string;
  readonly rpcUrls: string[];
  readonly chainType: "bft" | "tm2";

  // Initialize the client with a list of RPC URLs and a chain ID.
  constructor(rpcUrls: string[], chainId: string, chainType: "bft" | "tm2") {
    this.chainId = chainId;
    this.rpcUrls = Array<string>(rpcUrls.length);
    for (let [i, url] of rpcUrls.entries()) {
      url = url.trim(); // just to be sure
      if (url.endsWith("/")) {
        url = url.slice(0, -1);
      }
      this.rpcUrls[i] = url;
    }
    this.chainType = chainType;
  }

  // Get RPC client chain ID
  public get getId(): string {
    return this.chainId;
  }

  // Get number of RPC URLs
  public get rpcCount(): number {
    return this.rpcUrls.length;
  }

  /**
   * Check the health of the RPC URLs and return a list of healthy and unhealthy RPC URLs.
   * @returns A list of healthy and unhealthy RPC URLs.
   */
  public async checkHealth(): Promise<{ healthyRpcs: string[]; unhealthyRpcs: string[] }> {
    let highestHeight = 0;
    const responsiveRpcUrls = new Map<string, number>();
    const results = await Promise.all(
      this.rpcUrls.map(async (rpcUrl) => {
        const status = await getStatus(rpcUrl);
        if (status.ok) {
          return { rpcUrl, ok: true as const, data: status.data };
        } else {
          return { rpcUrl, ok: false as const, error: status.error };
        }
      }),
    );

    const healthyRpcs: string[] = [];
    const unhealthyRpcs: string[] = [];

    for (const result of results) {
      if (result.ok) {
        // Small basic checker here. If it fails here it won't make it on the list.
        if (
          this.chainId === result.data.result.nodeInfo.network &&
          result.data.result.syncInfo.catchingUp === false
        ) {
          const height = Number(result.data.result.syncInfo.latestBlockHeight ?? 0);
          if (height > highestHeight) {
            highestHeight = height;
            responsiveRpcUrls.set(result.rpcUrl, height);
          }
        } else {
          unhealthyRpcs.push(result.rpcUrl);
        }
      } else {
        unhealthyRpcs.push(result.rpcUrl);
      }
    }

    for (const [rpcUrl, height] of responsiveRpcUrls.entries()) {
      // Check if the RPC URL is within the maximum height difference
      if (height > highestHeight - MAX_HEIGHT_DIFFERENCE) {
        healthyRpcs.push(rpcUrl);
      } else {
        unhealthyRpcs.push(rpcUrl);
      }
    }

    return { healthyRpcs, unhealthyRpcs };
  }

  // Wrapper for getStatus query
  public async getStatus(rpcUrl: string): Promise<Response<RpcStatusResponse>> {
    return getStatus(rpcUrl);
  }

  // Wrapper for getCommit query
  public async getCommit(rpcUrl: string, height?: number): Promise<Response<BlockCommitResponse>> {
    return getCommit(rpcUrl, undefined, height);
  }
}
