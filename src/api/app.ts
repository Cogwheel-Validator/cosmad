import { Scalar } from "@scalar/hono-api-reference";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { trimTrailingSlash } from "hono/trailing-slash";
import { openAPIRouteHandler } from "hono-openapi";
import type { ChainConfig } from "../config/app_config";
import type { IApiReadDb } from "../pkgs/database/interfaces";
import { alertsRouter } from "./routes/alerts";
import { blocksRouter } from "./routes/blocks";
import { overviewRouter } from "./routes/overview";
import { statsRouter } from "./routes/stats";
import { sseBus } from "./sse";
import type { SseEvent } from "./types";
import { startWatcher } from "./watcher";

export async function createApp(databases: Map<string, IApiReadDb>, chains: ChainConfig[]) {
  await startWatcher(databases);
  const app = new Hono();
  const supportedChains = [...databases.keys()];

  // set up middleware
  app.use("/api/*", cors());
  app.use(trimTrailingSlash());

  app.get("/api/v1/chains", (c) => c.json({ chains: supportedChains }));
  app.route("/api/v1/chains", blocksRouter(databases));
  app.route("/api/v1/chains", alertsRouter(databases));
  app.route("/api/v1/chains", statsRouter(databases));
  app.route("/api/v1", overviewRouter(databases, chains));

  app.get(
    "/api/openapi.json",
    openAPIRouteHandler(app, {
      documentation: {
        info: { title: "cosmad API", version: "1.0.0" },
      },
    }),
  );
  app.get("/api/reference", Scalar({ url: "/api/openapi.json" }));

  app.get("/api/v1/events", (c) => {
    return streamSSE(c, async (stream) => {
      let closed = false;

      const handler = (event: SseEvent) => {
        if (closed) return;
        stream.writeSSE({ event: event.type, data: JSON.stringify(event) }).catch(() => {
          closed = true;
        });
      };

      sseBus.on("event", handler);

      stream.onAbort(() => {
        closed = true;
        sseBus.off("event", handler);
      });

      while (!closed) {
        await stream.sleep(15_000);
        if (closed) break;
        await stream.writeSSE({ event: "ping", data: String(Date.now()) }).catch(() => {
          closed = true;
        });
      }

      sseBus.off("event", handler);
    });
  });

  return app;
}
