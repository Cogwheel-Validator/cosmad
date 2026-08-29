import { config } from "../config/app_config";
import { EngineConnection } from "../engine/client";
import type { IApiReadDb } from "../pkgs/database/interfaces";
import logger from "../pkgs/logger";
import { startApiServer } from "./server";

/**
 * API process entry point which serves HTTP server and frontend dashboard.
 * assets. Gets data via ApiEngineClient.
 * INFO, can only allow to read the database, not write.
 */

const isDev = process.env.NODE_ENV !== "production";
const log = logger.child({ module: "APIProcess" });

async function main() {
  if (!config.api.enabled) {
    log.info("API is disabled (serve_api=false in config) - exiting");
    return;
  }

  const enableDashboard = config.api.dashboardEnabled;

  log.info("API process starting [%s]", isDev ? "dev" : "prod");

  const connection = await EngineConnection.connect(config.engineSocketPath, "reader");
  const readDbs = new Map<string, IApiReadDb>();
  for (const chain of config.chains) {
    readDbs.set(chain.chainId, connection.forApiChain(chain.chainId, chain.chainType));
  }

  const stopServer = await startApiServer(
    readDbs,
    config.chains,
    config.api.port,
    isDev,
    enableDashboard,
  );

  const shutdown = () => {
    log.info("API process shutting down…");
    stopServer();
    connection.close();
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  process.send?.({ type: "ready" });
  log.info("API process ready on port %d", config.api.port);
}

main().catch((err: unknown) => {
  console.error("API process fatal error:", err);
  process.exit(1);
});
