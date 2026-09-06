import { type } from "arktype";
import { Hono } from "hono";
import { describeRoute, resolver, validator } from "hono-openapi";
import type { IApiReadDb } from "../../pkgs/database/interfaces";
import { buildChainStats } from "../types";

const chainIdParam = type({ chainId: "string" });

const MIN_DAYS = 1;
const MAX_DAYS = 365;
const DEFAULT_DAYS = 30;

const statsQuery = type({ "days?": "string.integer.parse" }).pipe((q) => ({
  days: q.days == null ? DEFAULT_DAYS : Math.min(Math.max(q.days, MIN_DAYS), MAX_DAYS),
}));

const statsSchema = type({
  chainId: "string",
  days: "number",
  totalBlocks: "number",
  missedBlocks: "number",
  percentageSigner: "number",
  daily: type({
    date: "string.date",
    total: "number",
    missed: "number",
    percentSigned: "number | null",
  }).array(),
});
const errorSchema = type({ error: "string" });

/**
 * statsRouter creates a Hono router with endpoints for chain stats.
 * @param databases map of chain IDs and database connections
 * @returns a hono route
 */
export function statsRouter(databases: Map<string, IApiReadDb>) {
  const router = new Hono();

  router.get(
    "/:chainId/stats",
    describeRoute({
      summary: "Chain stats",
      tags: ["Stats"],
      responses: {
        200: {
          description: "Chain stats",
          content: {
            "application/json": {
              schema: resolver(statsSchema),
            },
          },
        },
        404: {
          description: "Chain not found",
          content: {
            "application/json": {
              schema: resolver(errorSchema),
            },
          },
        },
      },
    }),
    validator("param", chainIdParam),
    validator("query", statsQuery),
    async (c) => {
      const { chainId } = c.req.valid("param");
      const db = databases.get(chainId);
      if (!db) return c.json({ error: "Chain not found" }, 404);

      const { days } = c.req.valid("query");

      const result = await db.getDailySignedStats(days);
      if (!result.ok) return c.json({ error: result.error.message }, 500);

      return c.json(buildChainStats(chainId, days, result.value));
    },
  );

  return router;
}
