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

async function main() {
  log.info("Engine process starting");

  const db = await RWDB.create(config.dbDir, config.dbOptions);
  const knownChainIds = new Map(config.chains.map((chain) => [chain.chainId, chain.chainType]));

  const stopServer = await startEngineServer(db, knownChainIds, config.engineSocketPath);
  log.info("Engine ready on %s", config.engineSocketPath);
  process.send?.({ type: "ready" });

  const shutdown = () => {
    log.info("Engine process shutting down…");
    stopServer();
    db.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err: unknown) => {
  console.error("Engine process fatal error:", err);
  process.exit(1);
});
