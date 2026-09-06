import { type } from "arktype";
import { Hono } from "hono";
import { describeRoute, resolver, validator } from "hono-openapi";
import type { IApiReadDb } from "../../pkgs/database/interfaces";
import { serializeBlock } from "../types";

const chainIdParam = type({ chainId: "string" });
const heightParam = type({
  chainId: "string",
  height: "string.numeric > 0",
}).pipe((p) => ({ chainId: p.chainId, height: BigInt(p.height) }));

const MIN_LIMIT = 1;
const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 100;
const recentBlocksQuery = type({ "limit?": "string.integer.parse" }).pipe((q) => ({
  limit: q.limit == null ? DEFAULT_LIMIT : Math.min(Math.max(q.limit, MIN_LIMIT), MAX_LIMIT),
}));

const blockSchema = type({
  height: "string",
  hash: "string",
  time: "string",
  signed: "number",
  signature: "string | null",
});
const errorSchema = type({ error: "string" });

/**
 * blockRouter creates a Hono router with endpoints for blocks.
 * @param databases map of chain IDs and database API connection
 * @returns a new hono route for blocks
 */
export function blocksRouter(databases: Map<string, IApiReadDb>) {
  const router = new Hono();

  router.get(
    "/:chainId/blocks/latest",
    describeRoute({
      summary: "Get the latest indexed block for a chain",
      tags: ["Blocks"],
      responses: {
        200: {
          description: "The latest block, or null if none has been indexed yet",
          content: {
            "application/json": { schema: resolver(type({ block: blockSchema.or("null") })) },
          },
        },
        404: {
          description: "Chain not found",
          content: { "application/json": { schema: resolver(errorSchema) } },
        },
      },
    }),
    validator("param", chainIdParam),
    async (c) => {
      const { chainId } = c.req.valid("param");

      const db = databases.get(chainId);
      if (!db) return c.json({ error: "Chain not found" }, 404);

      const result = await db.latestBlock();
      if (!result.ok) return c.json({ error: result.error.message }, 500);

      return c.json({ block: result.value ? serializeBlock(result.value) : null });
    },
  );

  router.get(
    "/:chainId/blocks/recent",
    describeRoute({
      description: "Get the most recent blocks for a chain",
      tags: ["Blocks"],
      responses: {
        200: {
          description: "The most recent blocks, newest first",
          content: {
            "application/json": { schema: resolver(type({ blocks: blockSchema.array() })) },
          },
        },
        404: {
          description: "Chain not found",
          content: { "application/json": { schema: resolver(errorSchema) } },
        },
      },
    }),
    validator("param", chainIdParam),
    validator("query", recentBlocksQuery),
    async (c) => {
      const { chainId } = c.req.valid("param");
      const db = databases.get(chainId);
      if (!db) return c.json({ error: "Chain not found" }, 404);

      const { limit } = c.req.valid("query");

      const latestResult = await db.latestBlockHeight();
      if (!latestResult.ok) return c.json({ error: latestResult.error.message }, 500);
      if (latestResult.value == null) return c.json({ blocks: [] });

      const endHeight = latestResult.value;
      const startHeight = endHeight - BigInt(limit - 1) > 0n ? endHeight - BigInt(limit - 1) : 1n;

      const result = await db.getBlockByRange(startHeight, endHeight);
      if (!result.ok) return c.json({ error: result.error.message }, 500);

      return c.json({ blocks: result.value.map(serializeBlock) });
    },
  );

  router.get(
    "/:chainId/blocks/:height",
    describeRoute({
      description: "Get a single block by height",
      tags: ["Blocks"],
      responses: {
        200: {
          description: "The block at the given height, or null if not indexed",
          content: {
            "application/json": { schema: resolver(type({ block: blockSchema.or("null") })) },
          },
        },
        404: {
          description: "Chain not found",
          content: { "application/json": { schema: resolver(errorSchema) } },
        },
      },
    }),
    validator("param", heightParam),
    async (c) => {
      const { chainId, height } = c.req.valid("param");

      const db = databases.get(chainId);
      if (!db) return c.json({ error: "Chain not found" }, 404);

      const result = await db.getBlockByHeight(height);
      if (!result.ok) return c.json({ error: result.error.message }, 500);

      return c.json({ block: result.value ? serializeBlock(result.value) : null });
    },
  );

  return router;
}
