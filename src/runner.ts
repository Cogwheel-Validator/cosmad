import { type ChildProcess, fork } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config/app_config";
import logger from "./pkgs/logger";

/**
 * Top-level process supervisor. Forks three independent processes and wires
 * their startup/shutdown together:
 *   - engine     owns each chain's DuckDB file, serves inserts/queries over a
 *                Unix domain socket (src/engine/)
 *   - ingestion  polls RPC/REST, writes via a "writer" EngineClient
 *   - api/app        serves HTTP/SSE, reads via a "reader" EngineClient
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const log = logger.child({ module: "Runner" });

const ext = __filename.endsWith(".ts") ? "ts" : "js";

const READY_TIMEOUT_MS = 30_000;
// The engine can spend a long time replaying an uncheckpointed DuckDB WAL on
// startup. It will use extended timeout.
const ENGINE_READY_TIMEOUT_MS = 300_000;

// Tracks the engine child's PID across runs, so a leftover engine from a run that
// died without cleanly shutting its children down.
const ENGINE_PID_FILE = resolve(config.dbDir, "engine.pid");
const STALE_ENGINE_KILL_TIMEOUT_MS = 10_000;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readCmdline(pid: number): string | null {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, "utf8");
  } catch {
    return null;
  }
}

// Finds a leftover engine process from a previous run and kill it.
async function reapStaleEngine(): Promise<void> {
  if (!existsSync(ENGINE_PID_FILE)) return;

  const pid = Number.parseInt(readFileSync(ENGINE_PID_FILE, "utf8").trim(), 10);
  rmSync(ENGINE_PID_FILE, { force: true });
  if (!Number.isInteger(pid) || !isAlive(pid)) return;

  // Confirm this PID is actually still DuckDB engine before signaling it.
  const cmdline = readCmdline(pid);
  if (cmdline === null || !cmdline.includes("engine/main")) {
    log.warn("Stale pidfile referenced PID %d, which is no longer the engine - ignoring", pid);
    return;
  }

  log.warn("Found a leftover engine process from a previous run (PID %d) - terminating it", pid);
  process.kill(pid, "SIGTERM");

  const deadline = Date.now() + STALE_ENGINE_KILL_TIMEOUT_MS;
  while (isAlive(pid) && Date.now() < deadline) await sleep(200);

  if (isAlive(pid)) {
    log.error(
      "PID %d did not exit within %dms of SIGTERM - sending SIGKILL",
      pid,
      STALE_ENGINE_KILL_TIMEOUT_MS,
    );
    process.kill(pid, "SIGKILL");
    while (isAlive(pid)) await sleep(100);
  }
  log.info("Leftover engine process (PID %d) terminated", pid);
}

function waitForReady(
  child: ChildProcess,
  name: string,
  timeoutMs: number = READY_TIMEOUT_MS,
): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`${name} did not report ready within ${timeoutMs}ms`)),
      timeoutMs,
    );
    child.once("message", (msg: unknown) => {
      if (typeof msg === "object" && msg !== null && (msg as { type?: unknown }).type === "ready") {
        clearTimeout(timeout);
        resolvePromise();
      }
    });
  });
}

async function main() {
  log.info("Starting cosmad");

  const children: ChildProcess[] = [];
  let shuttingDown = false;

  const killAll = (exitCode: number) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info("Terminating all child processes…");
    for (const child of children) child.kill("SIGTERM");
    process.exit(exitCode);
  };

  const spawn = (relPath: string, name: string): ChildProcess => {
    const child = fork(resolve(__dirname, relPath), [], {
      execArgv: process.execArgv,
      env: process.env,
    });
    child.on("exit", (code, signal) => {
      if (shuttingDown) return;
      if (code !== 0 || signal != null) {
        log.error(
          "%s exited unexpectedly (code=%s signal=%s) - terminating remaining processes",
          name,
          code,
          signal,
        );
        killAll(1);
      } else {
        log.info("%s exited cleanly", name);
      }
    });
    child.on("error", (err) => log.error("%s process error: %s", name, err));
    children.push(child);
    return child;
  };

  try {
    mkdirSync(config.dbDir, { recursive: true });
    await reapStaleEngine();

    const engine = spawn(`engine/main.${ext}`, "engine");
    if (engine.pid !== undefined) {
      writeFileSync(ENGINE_PID_FILE, String(engine.pid));
      engine.once("exit", () => rmSync(ENGINE_PID_FILE, { force: true }));
    }
    await waitForReady(engine, "engine", ENGINE_READY_TIMEOUT_MS);
    log.info("engine ready");

    const ingestion = spawn(`dp/main.${ext}`, "ingestion");
    await waitForReady(ingestion, "ingestion");
    log.info("ingestion ready");

    if (config.api.enabled) {
      const api = spawn(`api/main.${ext}`, "api");
      await waitForReady(api, "api");
      log.info("api ready");
    } else {
      log.info("api disabled (serve_api=false in config), not starting");
    }
  } catch (err) {
    log.error("Startup failed: %s", err);
    killAll(1);
    return;
  }

  process.on("SIGINT", () => killAll(0));
  process.on("SIGTERM", () => killAll(0));

  log.info("cosmad ready");
}

main().catch((err: unknown) => {
  console.error("Fatal runner error:", err);
  process.exit(1);
});
