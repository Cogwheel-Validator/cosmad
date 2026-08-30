import { type ChildProcess, fork } from "node:child_process";
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

function waitForReady(child: ChildProcess, name: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`${name} did not report ready within ${READY_TIMEOUT_MS}ms`)),
      READY_TIMEOUT_MS,
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
    const engine = spawn(`engine/main.${ext}`, "engine");
    await waitForReady(engine, "engine");
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
