import { createConnection, type Socket } from "node:net";
import {
  BlockWindowStats,
  type ChainSignatureStats,
  DailyBlockStats,
} from "../pkgs/database/analytics";
import type { IApiReadDb, IWriteDb } from "../pkgs/database/interfaces";
import type { Alert, Block } from "../pkgs/database/tables";
import type { Result } from "../pkgs/models/result";
import {
  alertToWire,
  blockToWire,
  type chainType,
  type EngineOps,
  type EngineRequestBody,
  type EngineResponse,
  type EngineRole,
  type ResultOf,
  wireToAlert,
  wireToBlock,
  wireToChainSignatureStats,
} from "./protocol";
import { onLines, sendLine } from "./socket";

function toResult<K extends keyof EngineOps, T>(
  response: EngineResponse,
  map: (value: ResultOf<K>) => T,
): Result<T, Error> {
  if (!response.body.ok) return { ok: false, error: new Error(response.body.error) };
  // response.value is `unknown` on the wire (JSON has no type info), but the caller always
  // passes the K that matches the request it sent, so this cast is sound in practice.
  return { ok: true, value: map(response.body.value as ResultOf<K>) };
}

/**
 * One socket connection to the engine, shared across every chain a process
 * cares about - EngineClient (below) is a lightweight per-chain view over it.
 */
export class EngineConnection {
  private socket: Socket;
  private nextId = 1;
  private pending = new Map<number, (response: EngineResponse) => void>();

  private constructor(socket: Socket) {
    this.socket = socket;
    onLines(socket, (line) => {
      const response = JSON.parse(line) as EngineResponse;
      const resolve = this.pending.get(response.id);
      if (resolve) {
        this.pending.delete(response.id);
        resolve(response);
      }
    });
  }

  public static async connect(socketPath: string, role: EngineRole): Promise<EngineConnection> {
    const socket = await new Promise<Socket>((resolve, reject) => {
      const s = createConnection(socketPath);
      s.once("connect", () => resolve(s));
      s.once("error", reject);
    });
    const connection = new EngineConnection(socket);
    sendLine(socket, { type: "hello", role });
    return connection;
  }

  public forChain(chainId: string, chainType: chainType): EngineClient {
    return new EngineClient(this, chainId, chainType);
  }

  /**
   * forApiChain returns an IApiReadDb view of the chain, suitable for the API process.
   * @param chainId unique chain id
   * @param chainType chain type (bft or tm2)
   * @returns an IApiReadDb view of the chain
   */
  public forApiChain(chainId: string, chainType: chainType): IApiReadDb {
    return new ApiEngineClient(this, chainId, chainType);
  }

  public request(body: EngineRequestBody): Promise<EngineResponse> {
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      sendLine(this.socket, { id, body });
    });
  }

  public close(): void {
    this.socket.end();
  }
}

/** Per-chain facade implementing IWriteDb over a shared EngineConnection. */
export class EngineClient implements IWriteDb {
  constructor(
    private connection: EngineConnection,
    private chainId: string,
    private chainType: chainType,
  ) {}

  public async appendBlocks(blocks: Block[]): Promise<Result<void, Error>> {
    const response = await this.connection.request({
      type: "appendBlocks",
      chainId: this.chainId,
      blocks: blocks.map((b) => blockToWire(b, this.chainType)),
    });
    return toResult(response, () => undefined);
  }

  public async insertBlocks(blocks: Block[]): Promise<Result<void, Error>> {
    const response = await this.connection.request({
      type: "insertBlocks",
      chainId: this.chainId,
      blocks: blocks.map((b) => blockToWire(b, this.chainType)),
    });
    return toResult(response, () => undefined);
  }

  public async latestBlock(): Promise<Result<Block | null, Error>> {
    const response = await this.connection.request({
      type: "latestBlock",
      chainId: this.chainId,
      chainType: this.chainType,
    });
    return toResult<"latestBlock", Block | null>(response, (value) =>
      value ? wireToBlock(value, this.chainType) : null,
    );
  }

  public async latestBlockHeight(): Promise<Result<bigint | null, Error>> {
    const response = await this.connection.request({
      type: "latestBlockHeight",
      chainId: this.chainId,
    });
    return toResult<"latestBlockHeight", bigint | null>(response, (value) =>
      value != null ? BigInt(value) : null,
    );
  }

  public async insertAlert(alert: Alert): Promise<Result<void, Error>> {
    const response = await this.connection.request({
      type: "insertAlert",
      chainId: this.chainId,
      alert: alertToWire(alert),
    });
    return toResult(response, () => undefined);
  }

  public async getAlert(alertKey: string): Promise<Result<Alert | null, Error>> {
    const response = await this.connection.request({
      type: "getAlert",
      chainId: this.chainId,
      alertKey,
    });
    return toResult<"getAlert", Alert | null>(response, (value) =>
      value ? wireToAlert(value) : null,
    );
  }

  public async getUnclosedAlerts(): Promise<Result<Alert[], Error>> {
    const response = await this.connection.request({
      type: "getUnclosedAlerts",
      chainId: this.chainId,
    });
    return toResult<"getUnclosedAlerts", Alert[]>(response, (value) => value.map(wireToAlert));
  }

  public async closeAlert(alertId: string, closedAt: Date): Promise<Result<void, Error>> {
    const response = await this.connection.request({
      type: "closeAlert",
      chainId: this.chainId,
      alertId,
      closedAt: closedAt.toISOString(),
    });
    return toResult(response, () => undefined);
  }

  public async touchAlertNotified(
    alertId: string,
    notifiedAt: Date,
    repeatCount: number,
  ): Promise<Result<void, Error>> {
    const response = await this.connection.request({
      type: "touchAlertNotified",
      chainId: this.chainId,
      alertId,
      notifiedAt: notifiedAt.toISOString(),
      repeatCount,
    });
    return toResult(response, () => undefined);
  }

  public async getBlockByHeight(height: bigint): Promise<Result<Block | null, Error>> {
    const response = await this.connection.request({
      type: "getBlockByHeight",
      chainId: this.chainId,
      blockHeight: height.toString(),
      chainType: this.chainType,
    });
    return toResult<"getBlockByHeight", Block | null>(response, (value) =>
      value ? wireToBlock(value, this.chainType) : null,
    );
  }

  public async getBlockByRange(
    startHeight: bigint,
    endHeight: bigint,
  ): Promise<Result<Block[], Error>> {
    const response = await this.connection.request({
      type: "getBlockByRange",
      chainId: this.chainId,
      startHeight: startHeight.toString(),
      endHeight: endHeight.toString(),
      chainType: this.chainType,
    });
    return toResult<"getBlockByRange", Block[]>(response, (value) =>
      value.map((v) => wireToBlock(v, this.chainType)),
    );
  }

  public async getBlockStats(
    startHeight: bigint,
    endHeight: bigint,
  ): Promise<Result<BlockWindowStats, Error>> {
    const response = await this.connection.request({
      type: "getBlockStats",
      chainId: this.chainId,
      startHeight: startHeight.toString(),
      endHeight: endHeight.toString(),
    });
    return toResult<"getBlockStats", BlockWindowStats>(
      response,
      (value) => new BlockWindowStats(value.total, value.missed),
    );
  }

  public async getChainSignedPercentage(
    days: number,
  ): Promise<Result<ChainSignatureStats | null, Error>> {
    const response = await this.connection.request({
      type: "getChainSignedPercentage",
      chainId: this.chainId,
      days,
    });
    return toResult<"getChainSignedPercentage", ChainSignatureStats | null>(response, (value) =>
      value ? wireToChainSignatureStats(value) : null,
    );
  }

  public async getDailySignedStats(days: number): Promise<Result<DailyBlockStats[], Error>> {
    const response = await this.connection.request({
      type: "getDailySignedStats",
      chainId: this.chainId,
      days,
    });
    return toResult<"getDailySignedStats", DailyBlockStats[]>(response, (value) =>
      value.map((v) => new DailyBlockStats(v.date, v.total, v.missed)),
    );
  }

  /** Warning: the underlying socket is shared across chains, so call EngineConnection.close() only once. */
  public close(): void {}
}

// ApiEngineClient is an IApiReadDb view of the chain, suitable for the API process.
// It should provide a class, that has less exposure than EngineClient, no write methods
// and there shouldn't be any way to call write methods on it.
export class ApiEngineClient implements IApiReadDb {
  private client: EngineClient;

  constructor(connection: EngineConnection, chainId: string, chainType: chainType) {
    this.client = new EngineClient(connection, chainId, chainType);
  }

  public latestBlock(): Promise<Result<Block | null, Error>> {
    return this.client.latestBlock();
  }

  public latestBlockHeight(): Promise<Result<bigint | null, Error>> {
    return this.client.latestBlockHeight();
  }

  public getAlert(alertKey: string): Promise<Result<Alert | null, Error>> {
    return this.client.getAlert(alertKey);
  }

  public getUnclosedAlerts(): Promise<Result<Alert[], Error>> {
    return this.client.getUnclosedAlerts();
  }

  public getChainSignedPercentage(
    days: number,
  ): Promise<Result<ChainSignatureStats | null, Error>> {
    return this.client.getChainSignedPercentage(days);
  }

  public getDailySignedStats(days: number): Promise<Result<DailyBlockStats[], Error>> {
    return this.client.getDailySignedStats(days);
  }

  public getBlockByHeight(height: bigint): Promise<Result<Block | null, Error>> {
    return this.client.getBlockByHeight(height);
  }

  public getBlockByRange(start: bigint, end: bigint): Promise<Result<Block[], Error>> {
    return this.client.getBlockByRange(start, end);
  }

  /** Warning: the underlying socket is shared across chains, so call EngineConnection.close() only once. */
  public close(): void {}
}
