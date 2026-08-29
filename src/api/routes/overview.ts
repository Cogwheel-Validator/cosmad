import { Hono } from "hono";
import type { ChainConfig } from "../../config/app_config";
import type { DailyBlockStats } from "../../pkgs/database/analytics";
import type { IApiReadDb } from "../../pkgs/database/interfaces";
import type { ChainOverviewJson, ChainStatus, OverviewJson } from "../types";
import { serializeDailyStats } from "../types";
import { validDays } from "./validation";

const DEFAULT_STALLED_MULTIPLIER = 5;

/**
 * Determines the status of a chain based on the latest block time and chain configuration.
 * @param chainCfg the chain configuration
 * @param latestBlockTime last block time, or null if no block has been seen
 * @returns "online" or "stalled"
 */
function chainStatus(chainCfg: ChainConfig, latestBlockTime: Date | null): ChainStatus {
  if (latestBlockTime == null) return "stalled";
  const thresholdMs = chainCfg.alertConfig.stalledAlert.enabled
    ? chainCfg.alertConfig.stalledAlert.stalledThreshold * 1000
    : (chainCfg.pollIntervalMs ?? 6000) * DEFAULT_STALLED_MULTIPLIER;
  return Date.now() - latestBlockTime.getTime() < thresholdMs ? "online" : "stalled";
}

/**
 * Calculates the percentage of blocks that have been signed (i.e. not missed) for a given chain.
 * @param total the amount of blocks that has been produced
 * @param missed the amount of blocks that have been missed
 * @returns the percentage of blocks that have been signed, or null if no blocks have been produced
 */
function percentageSigned(total: number, missed: number): number | null {
  return total > 0 ? (total - missed) / total : null;
}

/**
 * Merges each chain's daily buckets into one combined series, keyed by date.
 * @param perChainDaily the daily block stats for each chain
 * @returns the combined daily block stats
 */
function combineDaily(perChainDaily: DailyBlockStats[][]): DailyBlockStats[] {
  const byDate = new Map<string, { total: number; missed: number }>();
  for (const daily of perChainDaily) {
    for (const day of daily) {
      const existing = byDate.get(day.date) ?? { total: 0, missed: 0 };
      existing.total += day.total;
      existing.missed += day.missed;
      byDate.set(day.date, existing);
    }
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, { total, missed }]) => ({ date, total, missed }));
}

/**
 * overviewRouter creates a Hono router with an overview endpoint that returns the combined daily block stats for all chains
 * @param databases map of chain IDs to database connections
 * @param chainCfgs array of chain configurations
 * @returns a Hono router with an overview endpoint
 */
export function overviewRouter(databases: Map<string, IApiReadDb>, chainCfgs: ChainConfig[]) {
  const router = new Hono();
  const chainsById = new Map(chainCfgs.map((c) => [c.chainId, c]));

  router.get("/overview", async (c) => {
    const days = validDays(c.req.query("days"));

    const chainResults: ChainOverviewJson[] = [];
    const perChainDaily: DailyBlockStats[][] = [];

    for (const [chainId, db] of databases) {
      const chain = chainsById.get(chainId);
      if (!chain) continue;

      const [latestResult, dailyResult] = await Promise.all([
        db.latestBlock(),
        db.getDailySignedStats(days),
      ]);

      const latestBlock = latestResult.ok ? latestResult.value : null;
      const daily = dailyResult.ok ? dailyResult.value : [];
      perChainDaily.push(daily);

      const totalBlocks = daily.reduce((sum, d) => sum + d.total, 0);
      const missedBlocks = daily.reduce((sum, d) => sum + d.missed, 0);

      chainResults.push({
        chainId,
        prettyName: chain.prettyName,
        chainLogo: chain.chainLogo ?? null,
        status: chainStatus(chain, latestBlock?.time ?? null),
        latestHeight: latestBlock ? latestBlock.height.toString() : null,
        latestBlockTime: latestBlock ? latestBlock.time.toISOString() : null,
        totalBlocks,
        missedBlocks,
        percentageSigned: percentageSigned(totalBlocks, missedBlocks),
      });
    }

    const combined = combineDaily(perChainDaily);
    const combinedTotal = combined.reduce((sum, d) => sum + d.total, 0);
    const combinedMissed = combined.reduce((sum, d) => sum + d.missed, 0);

    const response: OverviewJson = {
      days,
      chains: chainResults,
      combined: {
        totalBlocks: combinedTotal,
        missedBlocks: combinedMissed,
        percentageSigned: percentageSigned(combinedTotal, combinedMissed),
        daily: combined.map(serializeDailyStats),
      },
    };

    return c.json(response);
  });

  return router;
}
