# syntax=docker/dockerfile:1

# build: compile backend + dashboard
FROM node:24.22.3-trixie-slim AS build
WORKDIR /app
RUN corepack enable
ENV HUSKY=0

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json biome.json ./
COPY src ./src
RUN pnpm run build:docker

# Guard: the runtime image only ships @duckdb/node-api; fail if the bundle needs anything else.
COPY scripts/check-bundle.mjs ./scripts/
RUN node scripts/check-bundle.mjs dist

# native deps: only DuckDB stays external (esbuild cannot bundle .node binaries);
# everything else is inlined into dist/ by esbuild. npm picks the bindings for this platform.
FROM node:24.22.3-trixie-slim AS deps
WORKDIR /app
COPY package.json ./
RUN node -e 'const v=require("./package.json").dependencies["@duckdb/node-api"];require("fs").writeFileSync("package.json",JSON.stringify({name:"native",private:true,dependencies:{"@duckdb/node-api":v}}))' \
  && npm install --omit=dev --no-audit --no-fund

# ---- runtime ----
# Debian (glibc) based on purpose: the DuckDB native bindings do not run on musl/Alpine.
FROM node:24.22.3-trixie-slim
ENV NODE_ENV=production \
  HOST=0.0.0.0 \
  PORT=3000 \
  GLOBAL_CONFIG_PATH=/etc/cosmad/config.toml \
  CHAINS_DIRECTORY=/etc/cosmad/chains \
  DB_DIRECTORY=/var/lib/cosmad
WORKDIR /app

COPY --from=build /app/dist ./dist
COPY package.json ./
COPY --from=deps /app/node_modules ./node_modules

# /var/lib/cosmad holds the DuckDB file and the engine's Unix socket.
RUN mkdir -p /var/lib/cosmad /etc/cosmad/chains && chown -R node:node /var/lib/cosmad
USER node
VOLUME ["/var/lib/cosmad"]
EXPOSE 3000

# tini-less on purpose: runner.js forwards SIGTERM to its children and exits.
CMD ["node", "dist/runner.js"]
