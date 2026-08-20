import { HealthCheckNotifier } from "../alert/notifiers/healthcheck";
import { config } from "../config/app_config";
import { EngineConnection } from "../engine/client";
import logger from "../pkgs/logger";
import { runChainWorker } from "./chain_worker";

const log = logger.child({ module: "Ingestion" });

/**
 * Starts a single, global healthcheck ping loop which should run independent of chain count/state.
 * Its only purpose is to ping if the app is working or not.
 * @param healthCheckCfg The healthcheck configuration.
 * @returns A function to stop the healthcheck loop.
 */
function startHealthCheck(
  healthCheckCfg: NonNullable<typeof config.globalAlerts.healthCheck>,
): () => void {
  const healthLog = logger.child({ module: "HealthCheck" });
  const notifier = new HealthCheckNotifier(healthCheckCfg);
  let running = true;

  void notifier.sendStartPing(10000).then((r) => {
    if (!r.ok) healthLog.error("Failed to send healthcheck start ping: %s", r.error);
  });

  const intervalMs = healthCheckCfg.ping * 1000;
  const timer = setInterval(async () => {
    if (!running) return;
    const r = await notifier.sendSuccessPing(10000);
    if (!r.ok) healthLog.error("Failed to send healthcheck success ping: %s", r.error);
  }, intervalMs);

  return () => {
    running = false;
    clearInterval(timer);
  };
}

async function main() {
  log.info("Ingestion process starting");

  const connection = await EngineConnection.connect(config.engineSocketPath, "writer");
  const stopFns: Array<() => void> = [() => connection.close()];

  if (config.globalAlerts.healthCheck?.enabled) {
    stopFns.push(startHealthCheck(config.globalAlerts.healthCheck));
  }

  for (const chain of config.chains) {
    const db = connection.forChain(chain.chainId, chain.chainType);
    try {
      const stop = await runChainWorker(chain, db, config.globalAlerts);
      stopFns.push(stop);
    } catch (err) {
      // One chain's startup failing (e.g. its RPCs are all down right now) shouldn't block the
      // other chains from starting.
      log.error("Failed to start chain worker for %s, skipping: %s", chain.chainId, err);
    }
  }

  process.send?.({ type: "ready" });
  log.info("Ingestion process ready");

  const shutdown = () => {
    log.info("Ingestion process shutting down…");
    for (const stop of stopFns) stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err: unknown) => {
  console.error("Ingestion process fatal error:", err);
  process.exit(1);
});
