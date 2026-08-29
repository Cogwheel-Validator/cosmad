import { Hono } from "hono";
import type { IApiReadDb } from "../../pkgs/database/interfaces";
import { buildChainStats } from "../types";
import { validDays } from "./validation";

/**
 * statsRouter creates a Hono router with endpoints for chain stats.
 * @param databases map of chain IDs and database connections
 * @returns a hono route
 */
export function statsRouter(databases: Map<string, IApiReadDb>) {
  const router = new Hono();

  router.get("/:chainId/stats", async (c) => {
    const { chainId } = c.req.param();
    const db = databases.get(chainId);
    if (!db) return c.json({ error: "Chain not found" }, 404);

    const days = validDays(c.req.query("days"));

    const result = await db.getDailySignedStats(days);
    if (!result.ok) return c.json({ error: result.error.message }, 500);

    return c.json(buildChainStats(chainId, days, result.value));
  });

  return router;
}
