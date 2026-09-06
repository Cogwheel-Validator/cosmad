import { type } from "arktype";
import { Hono } from "hono";
import { describeRoute, resolver, validator } from "hono-openapi";
import type { IApiReadDb } from "../../pkgs/database/interfaces";
import { serializeAlert } from "../types";

const chainIdParam = type({ chainId: "string" });
const alertIdParam = type({ chainId: "string", alertId: "string.uuid.v4" });

const MIN_LIMIT = 1;
const MAX_LIMIT = 500; // probably an overkill for the number of alerts, but let it match the blocks for now
const DEFAULT_LIMIT = 100;
const PAGE_START = 1;
const PAGE_MAX = 500;

const alertsQuery = type({
  "limit?": "string.integer.parse",
  "page?": "string.integer.parse",
}).pipe((q) => {
  const limit = q.limit != null && q.limit > 0 ? q.limit : DEFAULT_LIMIT;
  const page = q.page != null && q.page > 0 ? q.page : PAGE_START;
  return {
    limit: Math.min(Math.max(limit, MIN_LIMIT), MAX_LIMIT),
    page: Math.max(Math.min(page, PAGE_MAX), PAGE_START),
  };
});

const alertSchema = type({
  chainId: "string",
  alertId: "string.uuid.v4",
  alertType: "string",
  openedAt: "string.date",
  closedAt: "string.date | null",
});
const errorSchema = type({ error: "string" });

/**
 * alertsRouter creates a Hono router with an alerts endpoint that returns the unclosed alerts for a given chain
 * @param databases a Map of chain ids and connection to the database
 * @returns a Hono router with an alerts endpoint that returns the unclosed alerts for a given chain
 */
export function alertsRouter(databases: Map<string, IApiReadDb>) {
  const router = new Hono();

  router.get(
    "/:chainId/alerts",
    describeRoute({
      summary: "Get unclosed alerts for a given chain",
      tags: ["Alerts"],
      responses: {
        200: {
          description: "The unclosed alerts for the given chain.",
          content: {
            "application/json": {
              schema: resolver(type({ alerts: alertSchema.array().or("null") })),
            },
          },
        },
        404: {
          description: "Chain not found",
          content: { "application/json": { schema: resolver(errorSchema) } },
        },
      },
    }),
    validator("query", alertsQuery),
    validator("param", chainIdParam),
    async (c) => {
      const { chainId } = c.req.valid("param");
      const { limit, page } = c.req.valid("query");

      const db = databases.get(chainId);
      if (!db) return c.json({ error: "Chain not found" }, 404);

      const result = await db.getUnclosedAlerts(limit, page);
      if (!result.ok) return c.json({ error: result.error.message }, 500);

      return c.json({ alerts: result.value.map(serializeAlert) });
    },
  );

  router.get(
    "/:chainId/alerts/:alertId",
    describeRoute({
      summary: "Get a specific alert by ID",
      tags: ["Alerts"],
      responses: {
        200: {
          description: "The alert info.",
          content: {
            "application/json": {
              schema: resolver(type({ alert: alertSchema })),
            },
          },
        },
        404: {
          description: "Alert not found",
          content: { "application/json": { schema: resolver(errorSchema) } },
        },
      },
    }),
    validator("param", alertIdParam),
    async (c) => {
      const { chainId, alertId } = c.req.valid("param");
      const db = databases.get(chainId);
      if (!db) return c.json({ error: "Chain not found" }, 404);

      const result = await db.getAlert(alertId);
      if (!result.ok) return c.json({ error: result.error.message }, 500);
      if (!result.value) return c.json({ error: "Alert not found" }, 404);

      return c.json({ alert: serializeAlert(result.value) });
    },
  );

  return router;
}
