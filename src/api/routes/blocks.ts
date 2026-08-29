import { ArkErrors } from "arktype";
import { Hono } from "hono";
import type { IApiReadDb } from "../../pkgs/database/interfaces";
import { serializeBlock } from "../types";
import { validHeight, validLimit } from "./validation";

/**
 * blockRouter creates a Hono router with endpoints for blocks.
 * @param databases map of chain IDs and database API connection
 * @returns a new hono route for blocks
 */
export function blocksRouter(databases: Map<string, IApiReadDb>) {
  const router = new Hono();

  router.get("/:chainId/blocks/latest", async (c) => {
    const { chainId } = c.req.param();

    // validate input
    const db = databases.get(chainId);
    if (!db) return c.json({ error: "Chain not found" }, 404);

    const result = await db.latestBlock();
    if (!result.ok) return c.json({ error: result.error.message }, 500);

    return c.json({ block: result.value ? serializeBlock(result.value) : null });
  });

  router.get("/:chainId/blocks/recent", async (c) => {
    const { chainId } = c.req.param();
    const db = databases.get(chainId);
    if (!db) return c.json({ error: "Chain not found" }, 404);

    const limit = validLimit(c.req.query("limit"));

    const latestResult = await db.latestBlockHeight();
    if (!latestResult.ok) return c.json({ error: latestResult.error.message }, 500);
    if (latestResult.value == null) return c.json({ blocks: [] });

    const endHeight = latestResult.value;
    const startHeight = endHeight - BigInt(limit - 1) > 0n ? endHeight - BigInt(limit - 1) : 1n;

    const result = await db.getBlockByRange(startHeight, endHeight);
    if (!result.ok) return c.json({ error: result.error.message }, 500);

    return c.json({ blocks: result.value.map(serializeBlock) });
  });

  router.get("/:chainId/blocks/:height", async (c) => {
    const { chainId, height } = c.req.param();

    // validate input
    if (!height) return c.json({ error: "Height is required" }, 400);
    const vH = validHeight(height);
    if (vH instanceof ArkErrors) return c.json({ error: "Invalid height" }, 400);
    const db = databases.get(chainId);
    if (!db) return c.json({ error: "Chain not found" }, 404);

    const result = await db.getBlockByHeight(vH);
    if (!result.ok) return c.json({ error: result.error.message }, 500);

    return c.json({ block: result.value ? serializeBlock(result.value) : null });
  });

  return router;
}
