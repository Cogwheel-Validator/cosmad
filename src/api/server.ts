import http from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getRequestListener } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import type { ChainConfig } from "../config/app_config";
import type { IApiReadDb } from "../pkgs/database/interfaces";
import logger from "../pkgs/logger";
import { createApp } from "./app";

const log = logger.child({ module: "APIServer" });

const __dirname = dirname(fileURLToPath(import.meta.url));
const frontendDist = resolve(__dirname, "../frontend/dist");

/**
 * Start the HTTP server. In development mode Vite runs in middleware mode on
 * the same port so HMR and the API share a single origin. In prod, Hono
 * serves the pre-built frontend assets from `frontend/dist`.
 * @param databases - The map for every chain and the database API interface.
 * @param chains - The config files.
 * @param port - The port to listen on.
 * @param isDev - Whether the server is running in development mode.
 * @param enableDashboard - Whether to enable the dashboard.
 * @returns A function that closes the server.
 */
export async function startApiServer(
  databases: Map<string, IApiReadDb>,
  chains: ChainConfig[],
  port: number,
  isDev: boolean,
  enableDashboard: boolean,
): Promise<() => void> {
  const app = await createApp(databases, chains);

  if (!isDev && enableDashboard) {
    app.use("/*", serveStatic({ root: frontendDist }));
    app.get("/*", serveStatic({ path: "index.html", root: frontendDist }));
  }

  const honoHandler = getRequestListener(app.fetch);

  let server: http.Server;

  if (isDev && enableDashboard) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      root: resolve(__dirname, "../frontend"),
      server: { middlewareMode: true },
      appType: "spa",
    });

    server = http.createServer((req, res) => {
      const url = req.url ?? "/";
      if (url.startsWith("/api/") || url === "/api" || url === "/events") {
        honoHandler(req, res).catch((err: unknown) => {
          log.error("Hono handler error: %s", err);
          if (!res.headersSent) {
            res.writeHead(500);
            res.end("Internal server error");
          }
        });
      } else {
        vite.middlewares(req, res, () => {
          res.statusCode = 404;
          res.end("Not found");
        });
      }
    });
  } else {
    server = http.createServer(honoHandler);
  }

  return new Promise<() => void>((resolvePromise) => {
    server.listen(port, () => {
      log.info(
        `Server running on http://localhost:${port} [${isDev ? "dev - Vite middleware" : "prod - static assets"}]`,
      );
      resolvePromise(() => server.close());
    });
  });
}
