import { Hono } from "hono";
import type { IApiReadDb } from "../../pkgs/database/interfaces";
import { serializeAlert } from "../types";
import { validLimit, validPage } from "./validation";

/**
 * alertsRouter creates a Hono router with an alerts endpoint that returns the unclosed alerts for a given chain
 * @param databases a Map of chain ids and connection to the database
 * @returns a Hono router with an alerts endpoint that returns the unclosed alerts for a given chain
 */
export function alertsRouter(databases: Map<string, IApiReadDb>) {
  const router = new Hono();

  router.get("/:chainId/alerts", async (c) => {
    const { chainId } = c.req.param();
    const { limit, page } = c.req.query();
    const limitNum = validLimit(limit);
    const pageNum = validPage(page);

    const db = databases.get(chainId);
    if (!db) return c.json({ error: "Chain not found" }, 404);

    const result = await db.getUnclosedAlerts(limitNum, pageNum);
    if (!result.ok) return c.json({ error: result.error.message }, 500);

    return c.json({ alerts: result.value.map(serializeAlert) });
  });

  router.get("/:chainId/alerts/:alertId", async (c) => {
    const { chainId, alertId } = c.req.param();
    const db = databases.get(chainId);
    if (!db) return c.json({ error: "Chain not found" }, 404);

    const result = await db.getAlert(alertId);
    if (!result.ok) return c.json({ error: result.error.message }, 500);
    if (!result.value) return c.json({ error: "Alert not found" }, 404);

    return c.json({ alert: serializeAlert(result.value) });
  });

  return router;
}
