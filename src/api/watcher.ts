import type { IApiReadDb } from "../pkgs/database/interfaces";
import logger from "../pkgs/logger";
import { sseBus } from "./sse";
import { serializeAlert, serializeBlock } from "./types";

const log = logger.child({ module: "Watcher" });

/**
 * Poll each chain's IApiReadDb for state changes and publish SSE events when
 * something new appears.
 *
 * Detects:
 *  - New blocks   → "block" + "chain_status: online"
 *  - New alerts   → "alert_opened"
 *  - Closed alerts → "alert_closed"
 *
 * @param databases - A map of chain IDs to IApiReadDb instances.
 * @param intervalMs - The polling interval in milliseconds.
 * @returns A stop function.
 */
export async function startWatcher(
  databases: Map<string, IApiReadDb>,
  intervalMs = 2_000,
): Promise<() => void> {
  const lastHeights = new Map<string, bigint>();
  const lastAlertIds = new Map<string, Set<string>>();

  for (const [chainId, db] of databases) {
    const h = await db.latestBlockHeight();
    lastHeights.set(chainId, (h.ok ? h.value : null) ?? 0n);

    const a = await db.getUnclosedAlerts();
    lastAlertIds.set(chainId, new Set((a.ok ? a.value : []).map((x) => x.alertId)));
  }

  const poll = async () => {
    for (const [chainId, db] of databases) {
      await checkBlocks(chainId, db);
      await checkAlerts(chainId, db);
    }
  };

  const checkBlocks = async (chainId: string, db: IApiReadDb) => {
    const hResult = await db.latestBlockHeight();
    if (!hResult.ok || hResult.value == null) return;

    const newHeight = hResult.value;
    const prevHeight = lastHeights.get(chainId) ?? 0n;
    if (newHeight <= prevHeight) return;

    lastHeights.set(chainId, newHeight);

    const bResult = await db.latestBlock();
    if (!bResult.ok || !bResult.value) return;

    sseBus.publish({
      type: "block",
      chainId,
      data: serializeBlock(bResult.value),
    });
    sseBus.publish({ type: "chain_status", chainId, status: "online" });
    log.debug("New block on %s: height %s", chainId, newHeight.toString());
  };

  const checkAlerts = async (chainId: string, db: IApiReadDb) => {
    const aResult = await db.getUnclosedAlerts();
    if (!aResult.ok) return;

    const current = aResult.value;
    const currentIds = new Set(current.map((a) => a.alertId));
    const prevIds = lastAlertIds.get(chainId) ?? new Set<string>();

    for (const alert of current) {
      if (!prevIds.has(alert.alertId)) {
        sseBus.publish({
          type: "alert_opened",
          chainId,
          data: serializeAlert(alert),
        });
        log.info("Alert opened on %s: %s", chainId, alert.alertType);
      }
    }

    for (const prevId of prevIds) {
      if (!currentIds.has(prevId)) {
        sseBus.publish({ type: "alert_closed", chainId, alertId: prevId });
        log.info("Alert closed on %s: %s", chainId, prevId);
      }
    }

    lastAlertIds.set(chainId, currentIds);
  };

  const handle = setInterval(() => {
    poll().catch((err: unknown) => log.error("Watcher poll error: %s", err));
  }, intervalMs);

  log.info("Started (interval: %dms, chains: %s)", intervalMs, [...databases.keys()].join(", "));

  return () => {
    clearInterval(handle);
    log.info("Stopped");
  };
}
