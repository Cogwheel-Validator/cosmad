import { spawn } from "node:child_process";
import { config } from "../config/app_config";
import { RWDB } from "../pkgs/database/duckdb/rw_db";
import logger from "../pkgs/logger";
import { startEngineServer } from "./server";

/**
 * Engine process entry point, owns a single shared DuckDB file (all chains
 * partitioned by a chain_id column, not one file per chain) and serves
 * inserts/queries to the ingestion and API processes over a Unix socket.
 */

const log = logger.child({ module: "Engine" });

// If DuckDB process persists, a watchdog process will be launched to SIGKILL us if we don't exit in time.
const SHUTDOWN_WATCHDOG_SECONDS = 5;

async function main() {
  log.info("Engine process starting");

  const db = await RWDB.create(config.dbDir, config.dbOptions);
  const knownChainIds = new Map(config.chains.map((chain) => [chain.chainId, chain.chainType]));

  const stopServer = await startEngineServer(db, knownChainIds, config.engineSocketPath);
  log.info("Engine ready on %s", config.engineSocketPath);
  process.send?.({ type: "ready" });

  let shuttingDown = false;

  const shutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info("Engine process shutting down (%s)…", signal);

    const watchdog = spawn(
      "sh",
      ["-c", `sleep ${SHUTDOWN_WATCHDOG_SECONDS}; kill -9 ${process.pid} 2>/dev/null`],
      { detached: true, stdio: "ignore" },
    );
    watchdog.unref();

    stopServer();
    db.close();
    watchdog.kill();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err: unknown) => {
  console.error("Engine process fatal error:", err);
  process.exit(1);
});
