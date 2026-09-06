import { existsSync, unlinkSync } from "node:fs";
import { createServer } from "node:net";
import type { RWDB } from "../pkgs/database/duckdb/rw_db";
import logger from "../pkgs/logger";
import type { Result } from "../pkgs/models/result";
import {
  alertToWire,
  blockToWire,
  chainSignatureStatsToWire,
  type chainType,
  type EngineOps,
  type EngineRequest,
  type EngineResponse,
  type EngineRole,
  type HelloMessage,
  WRITE_REQUEST_TYPES,
  wireToAlert,
  wireToBlock,
} from "./protocol";
import { onLines, sendLine } from "./socket";

const log = logger.child({ module: "EngineServer" });

interface Ctx {
  db: RWDB;
  chainType: chainType;
}

// A generic handler for every operation K: takes that op's params, returns that op's result, or an Error.
type Handler<K extends keyof EngineOps> = (
  params: EngineOps[K]["params"],
  ctx: Ctx,
) => Promise<Result<EngineOps[K]["result"], Error>>;

// One handler per key of EngineOps
type Handlers = { [K in keyof EngineOps]: Handler<K> };

const handlers: Handlers = {
  appendBlocks: (p, { db, chainType }) =>
    db.appendBlocks(
      p.chainId,
      p.blocks.map((b) => wireToBlock(b, chainType)),
    ),
  insertBlocks: (p, { db, chainType }) =>
    db.insertBlocks(
      p.chainId,
      p.blocks.map((b) => wireToBlock(b, chainType)),
    ),
  latestBlock: async (p, { db, chainType }) => {
    const r = await db.latestBlock(p.chainId, p.chainType);
    return r.ok ? { ok: true, value: r.value ? blockToWire(r.value, chainType) : null } : r;
  },
  latestBlockHeight: async (p, { db }) => {
    const r = await db.latestBlockHeight(p.chainId);
    return r.ok ? { ok: true, value: r.value != null ? r.value.toString() : null } : r;
  },
  insertAlert: (p, { db }) => db.insertAlert(wireToAlert(p.alert)),
  getAlert: async (p, { db }) => {
    const r = await db.getAlert(p.alertKey);
    return r.ok ? { ok: true, value: r.value ? alertToWire(r.value) : null } : r;
  },
  getUnclosedAlerts: async (p, { db }) => {
    const r = await db.getUnclosedAlerts(p.chainId, p.limit, p.page);
    return r.ok ? { ok: true, value: r.value.map(alertToWire) } : r;
  },
  closeAlert: (p, { db }) => db.closeAlert(p.alertId, new Date(p.closedAt)),
  touchAlertNotified: (p, { db }) =>
    db.touchAlertNotified(p.alertId, new Date(p.notifiedAt), p.repeatCount),
  getBlockByHeight: async (p, { db, chainType }) => {
    const r = await db.getBlockByHeight(p.chainId, BigInt(p.blockHeight), chainType);
    return r.ok ? { ok: true, value: r.value ? blockToWire(r.value, chainType) : null } : r;
  },
  getBlockByRange: async (p, { db, chainType }) => {
    const r = await db.getBlockByRange(
      p.chainId,
      BigInt(p.startHeight),
      BigInt(p.endHeight),
      chainType,
    );
    return r.ok ? { ok: true, value: r.value.map((b) => blockToWire(b, chainType)) } : r;
  },
  getBlockStats: async (p, { db }) => {
    const r = await db.getBlockStats(p.chainId, BigInt(p.startHeight), BigInt(p.endHeight));
    return r.ok ? { ok: true, value: { total: r.value.total, missed: r.value.missed } } : r;
  },
  getChainSignedPercentage: async (p, { db }) => {
    const r = await db.getChainSignedPercentage(p.chainId, p.days);
    return r.ok ? { ok: true, value: r.value ? chainSignatureStatsToWire(r.value) : null } : r;
  },
  getDailySignedStats: async (p, { db }) => {
    const r = await db.getDailySignedStats(p.chainId, p.days);
    return r.ok
      ? {
          ok: true,
          value: r.value.map((s) => ({ date: s.date, total: s.total, missed: s.missed })),
        }
      : r;
  },
};

async function dispatch(
  request: EngineRequest,
  db: RWDB,
  knownChainIds: Map<string, chainType>, //chainId + chainType
): Promise<EngineResponse> {
  const { id, body } = request;
  if (!knownChainIds.has(body.chainId)) {
    return { id, body: { ok: false, error: `Unknown chain '${body.chainId}'` } };
  }
  // biome-ignore lint/style/noNonNullAssertion: <the check above ensures this is defined>
  const chainType: chainType = knownChainIds.get(body.chainId)!;

  try {
    // body.type is one of keyof EngineOps by construction of EngineRequestBody, so this
    // lookup is safe even though TS can't itself prove a union-indexed lookup into a
    // mapped-type record preserves the per-key params/result pairing.
    const handler = handlers[body.type] as Handler<typeof body.type>;
    const r = await handler(body, { db, chainType });
    return {
      id,
      body: r.ok ? { ok: true, value: r.value } : { ok: false, error: r.error.message },
    };
  } catch (error) {
    return {
      id,
      body: { ok: false, error: error instanceof Error ? error.message : String(error) },
    };
  }
}

/**
 * Serves has a bunch inserts/queries for every configured chain over a Unix domain
 * socket. It is all backed by one shared RWDB, chains partitioned by chain_id, not one
 * DB per chain, as it was designed initially. Each connection must send a `{type: "hello", role}`
 * handshake first; "reader" connections have every write request type
 * rejected server-side so the API can only read from the DB, not write.
 * @param db The RWDB instance to use for all chain data.
 * @param knownChainIds A map of known chain IDs to their types.
 * @param socketPath The path to the Unix domain socket to listen on.
 */
export async function startEngineServer(
  db: RWDB,
  knownChainIds: Map<string, chainType>,
  socketPath: string,
): Promise<() => void> {
  if (existsSync(socketPath)) unlinkSync(socketPath);

  const server = createServer((socket) => {
    let role: EngineRole | null = null;

    async function handleLine(line: string): Promise<void> {
      const message = JSON.parse(line) as HelloMessage | EngineRequest;
      if ("type" in message && message.type === "hello") {
        role = message.role;
        return;
      }

      const request = message as EngineRequest;
      if (role == null) {
        sendLine(socket, {
          id: request.id,
          body: { ok: false, error: "No hello/role handshake received" },
        } satisfies EngineResponse);
        return;
      }
      if (role === "reader" && WRITE_REQUEST_TYPES.has(request.body.type)) {
        sendLine(socket, {
          id: request.id,
          body: { ok: false, error: `Read-only connection cannot perform '${request.body.type}'` },
        } satisfies EngineResponse);
        return;
      }

      const response = await dispatch(request, db, knownChainIds);
      sendLine(socket, response);
    }

    onLines(socket, (line) => {
      handleLine(line).catch((error: unknown) => {
        log.error("Connection error: %s", error);
        socket.destroy();
      });
    });

    socket.on("error", (error) => log.debug("Socket error: %s", error.message));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolve);
  });
  log.info("Listening on %s", socketPath);

  return () => {
    server.close();
    if (existsSync(socketPath)) unlinkSync(socketPath);
  };
}
