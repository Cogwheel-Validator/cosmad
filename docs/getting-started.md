# Getting started

## Requirements

- Linux (the supervisor reads `/proc` to clean up stale processes; macOS may
  work but is untested)
- Node.js 24 (glibc build; the DuckDB native bindings, have recently added for
  musl C compiler support, but it is untested)
- [pnpm](https://pnpm.io) (`corepack enable` will provide it)
- Reachable RPC endpoint(s) for each chain, plus REST (API) endpoint(s) for Cosmos
  SDK (`bft`) chains

## Build

```sh
pnpm install --frozen-lockfile
pnpm build          # backend -> dist/, dashboard -> dist/frontend/dist
```

## Configure

```sh
mkdir -p config/chains
cp config/config.example.toml config/config.toml
$EDITOR config/config.toml                 # API, dashboard, notifiers
cp config/examples/bft-chain.example.toml config/chains/<chain-id>.toml   # or tm2-chain.example.toml
$EDITOR config/chains/<chain-id>.toml      # one file per chain, see configuration.md
```

The example chain files document every setting in comments:
[bft](../config/examples/bft-chain.example.toml), [tm2](../config/examples/tm2-chain.example.toml).

`config/config.toml` and `config/chains/*.toml` are git-ignored because they hold secrets.
The file name of a chain config is its chain id: `cosmoshub-4.toml` -> `cosmoshub-4`.

A minimal Cosmos SDK (`bft`) chain config:

```toml
pretty_name = "Cosmos Hub"
chain_type = "bft"
valoper_address = "cosmosvaloper1..."
valcons_address = "cosmosvalcons1..."
rpc_urls = [{ url = "https://rpc.example.com", alert_if_down = true }]
api_urls = [{ url = "https://api.example.com", alert_if_down = true }]

alert_config = {
  alert_if_inactive = true,
  stalled_alert = { enabled = true, stalled_threshold = "1m" },
  consecutive_miss_alert = { enabled = true, threshold = 50, repeat = true, repeat_interval = "5m" },
  percentage_missed_blocks_alert = { enabled = true, threshold = 10.0, repeat = true }
}
```

Get your `valcons` address with `<daemon> tendermint show-address` on the
validator node.

And for Gnoland (`tm2`) chains:

```toml
pretty_name = "Gnoland"
chain_type = "tm2"
operator_address = "g1..."
signing_address = "g1..."
rpc_urls = [{ url = "https://rpc.gno.land", alert_if_down = true }]

alert_config = {
  alert_if_inactive = true,
  signing_window_size = 10000,
  stalled_alert = { enabled = true, stalled_threshold = "1m" },
  consecutive_miss_alert = { enabled = true, threshold = 50, repeat = false, repeat_interval = "5m" },
  percentage_missed_blocks_alert = { enabled = false, threshold = 10.0, repeat = false }
}
```

## Run

```sh
pnpm start          # NODE_ENV=production node dist/runner.js
```

Open <http://localhost:3000> for the dashboard and <http://localhost:3000/api/reference>
for the API docs.

Development: `pnpm dev` runs everything through `tsx` with the dashboard served
by Vite middleware
(hot reload) on the same port. `pnpm dev:engine`, `dev:ingest`, `dev:api` run single
processes.
Other scripts: `pnpm test`, `pnpm typecheck`, `pnpm check` (Biome).

> The process exits immediately on an invalid config, with the offending field in
> the log.
