export class CosmosRpcClient {
  readonly chainId: string;
  readonly rpcUrls: string[];
  healthyRpcs: string[] = [];
  constructor(rpcUrls: string[], chainId: string) {
    this.chainId = chainId;
    this.rpcUrls = Array<string>(rpcUrls.length)
    for (let [i, url] of rpcUrls.entries()) {
      url.trim(); // just to be sure
      if (url.endsWith("/")) {
        url = url.slice(0, -1);
    }
    this.rpcUrls[i] = url
  }

  public async checkHealth()
    for (const rpc in this.rpcUrls) {

    }
}
