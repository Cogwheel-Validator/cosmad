import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import axios from "axios";
import type { AlertConfig } from "@/config/alert_types";
import type { ChainConfig, GlobalAlertsConfig } from "@/config/app_config";
import { runChainWorker } from "@/dp/chain_worker";
import { type EngineClient, EngineConnection } from "@/engine/client";
import { startEngineServer } from "@/engine/server";
import { RWDB } from "@/pkgs/database/duckdb/rw_db";
import type { Alert, ValidatorInactivity } from "@/pkgs/database/tables";
import { FakeChain, type FakeChainOptions } from "./fake_chain";
import { NotificationSink } from "./notification_sink";

type AlertConfigType = typeof AlertConfig.infer;

export interface HarnessOptions extends FakeChainOptions {
  alertConfig?: Partial<AlertConfigType>;
  /** Poll interval of the chain worker. Small, so scenarios run quickly. */
  pollIntervalMs?: number;
  maxBlocksPerPoll?: number;
  /** Seconds between endpoint health checks. Small, so rpc_down/api_down react quickly. */
  healthCheckInterval?: number;
  /** alertIfDown per RPC / API node index. Defaults to true for every node. */
  rpcAlertIfDown?: boolean[];
  apiAlertIfDown?: boolean[];
}

const DEFAULT_ALERT_CONFIG: AlertConfigType = {
  alertIfInactive: true,
  signingWindowSize: 20,
  stalledAlert: { enabled: true, stalledThreshold: 60 },
  consecutiveMissAlert: { enabled: true, threshold: 3, repeat: false, repeatInterval: 3600 },
  percentageMissedBlocksAlert: { enabled: true, threshold: 50, repeat: false },
};

/**
 * Contained end-to-end environment for one chain:
 *
 *   FakeChain (real HTTP) -> QueryOperator -> runChainWorker/doPoll -> EngineClient
 *     -> Unix socket -> engine server -> DuckDB file in a temp dir
 *   alerts -> NotificationDispatcher -> Telegram/Discord/PagerDuty notifiers (real HTTP)
 *     -> NotificationSink
 *
 * Everything is real production code except the two ends (chain + notification services),
 * which are local fakes the test fully controls. Nothing touches the network outside 127.0.0.1.
 */
export class Harness {
  readonly chain: FakeChain;
  readonly sink = new NotificationSink();
  config!: ChainConfig;
  db!: EngineClient;

  private dir: string;
  private rwdb: RWDB | undefined;
  private stopEngine: (() => void) | undefined;
  private connection: EngineConnection | undefined;
  private stopWorkerFn: (() => void) | undefined;
  private interceptor: number | undefined;
  private pollWaiters: Array<() => void> = [];
  private pendingStop: (() => void) | undefined;
  private opts: HarnessOptions;

  /** Total poll cycles completed by the current worker. */
  polls = 0;

  constructor(opts: HarnessOptions = {}) {
    this.opts = opts;
    this.chain = new FakeChain(opts);
    this.dir = mkdtempSync(join(tmpdir(), "cosmad-e2e-"));
  }

  async setup(): Promise<void> {
    await this.chain.start();
    await this.sink.start();

    // Telegram and PagerDuty URLs are hard-coded in the notifiers - redirect them to the sink.
    this.interceptor = axios.interceptors.request.use((cfg) => {
      if (cfg.url != null) cfg.url = this.sink.rewrite(cfg.url);
      return cfg;
    });

    this.config = {
      chainId: this.chain.chainId,
      prettyName: "Fake Chain",
      chainType: "bft",
      valoperAddress: this.chain.valoperAddress,
      valconsAddress: this.chain.valconsAddress,
      rpcUrls: this.chain.rpcUrls.map((url, i) => ({
        url,
        alertIfDown: this.opts.rpcAlertIfDown?.[i] ?? true,
      })),
      apiUrls: this.chain.apiUrls.map((url, i) => ({
        url,
        alertIfDown: this.opts.apiAlertIfDown?.[i] ?? true,
      })),
      healthCheckInterval: this.opts.healthCheckInterval ?? 0.3,
      pollIntervalMs: this.opts.pollIntervalMs ?? 100,
      ...(this.opts.maxBlocksPerPoll != null
        ? { maxBlocksPerPoll: this.opts.maxBlocksPerPoll }
        : {}),
      alertConfig: { ...DEFAULT_ALERT_CONFIG, ...this.opts.alertConfig },
    };

    this.rwdb = await RWDB.create(join(this.dir, "db"), { threads: "1", memoryLimit: "256MB" });
    const socketPath = join(this.dir, "engine.sock");
    this.stopEngine = await startEngineServer(
      this.rwdb,
      new Map([[this.chain.chainId, "bft"]]),
      socketPath,
    );
    this.connection = await EngineConnection.connect(socketPath, "writer");
    this.db = this.connection.forChain(this.chain.chainId, "bft");
  }

  get globalAlerts(): GlobalAlertsConfig {
    return {
      telegram: { enabled: true, botToken: "fake-token", chatId: "-100" },
      discord: { enabled: true, webhookUrl: this.sink.discordUrl },
      pagerduty: { enabled: true, serviceKey: "fake-key" },
      healthCheck: undefined,
    };
  }

  /** Starts the real chain worker (same entry point the ingestion process uses). */
  async startWorker(): Promise<void> {
    if (this.stopWorkerFn) throw new Error("worker already running");
    this.polls = 0;
    this.stopWorkerFn = await runChainWorker(this.config, this.db, this.globalAlerts, {
      afterPoll: () => this.onPoll(),
    });
  }

  /** Stops the worker right after its current poll finishes, so nothing is left in flight. */
  async stopWorker(): Promise<void> {
    if (!this.stopWorkerFn) return;
    await new Promise<void>((resolve) => {
      this.pendingStop = resolve;
    });
  }

  private onPoll(): void {
    this.polls++;
    if (this.pendingStop) {
      this.stopWorkerFn?.();
      this.stopWorkerFn = undefined;
      const resolve = this.pendingStop;
      this.pendingStop = undefined;
      resolve();
    }
    const waiters = this.pollWaiters;
    this.pollWaiters = [];
    for (const w of waiters) w();
  }

  /**
   * Resolves once `n` further poll cycles have fully completed. Waiting for 2 guarantees at
   * least one complete poll that started after the caller's last change to the fake chain.
   */
  async waitForPolls(n = 2, timeoutMs = 15_000): Promise<void> {
    const target = this.polls + n;
    const deadline = Date.now() + timeoutMs;
    while (this.polls < target) {
      if (Date.now() > deadline) {
        throw new Error(`timed out waiting for ${n} polls (completed ${this.polls}/${target})`);
      }
      await new Promise<void>((resolve) => {
        this.pollWaiters.push(resolve);
        setTimeout(resolve, 250);
      });
    }
  }

  async openAlerts(): Promise<Alert[]> {
    const r = await this.db.getUnclosedAlerts(100, 1);
    if (!r.ok) throw r.error;
    return r.value;
  }

  async openAlertTypes(): Promise<string[]> {
    return (await this.openAlerts()).map((a) => a.alertType).sort();
  }

  /** Recorded validator inactivity periods, oldest first. */
  async inactivity(): Promise<ValidatorInactivity[]> {
    const r = await this.db.getInactivityHistory(100);
    if (!r.ok) throw r.error;
    return r.value.reverse();
  }

  /** Every stored block as [height, signed] pairs, ascending. */
  async storedBlocks(): Promise<Array<[number, number]>> {
    const r = await this.db.getBlockByRange(1n, BigInt(Math.max(this.chain.height, 1)));
    if (!r.ok) throw r.error;
    return r.value
      .map((b): [number, number] => [Number(b.height), b.signed])
      .sort((a, b) => a[0] - b[0]);
  }

  async teardown(): Promise<void> {
    await this.stopWorker();
    if (this.interceptor != null) axios.interceptors.request.eject(this.interceptor);
    this.connection?.close();
    this.stopEngine?.();
    this.rwdb?.close();
    await this.chain.stop();
    await this.sink.stop();
    rmSync(this.dir, { recursive: true, force: true });
  }
}
