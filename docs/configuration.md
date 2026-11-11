# Configuration

Cosmad is configured with three things:

1. **Environment variables**: paths, ports, DuckDB resources
2. **Global config** (`config.toml`): API/dashboard switches, notifiers, CORS/CSRF
3. **Chain configs** (one `.toml` per chain): endpoints, addresses, alert rules

TOML keys are written in `snake_case`; they are converted to camelCase internally.
Multi-line inline tables (as used for `alert_config` in the examples) are TOML 1.1 syntax; Cosmad's parser accepts them, but generic TOML 1.0 linters may not.
Configs are validated on start-up; an invalid value stops the process with a message naming the field.
There is no hot reload, so restart after changing a file.

## Environment variables

| Variable               | Default                      | Description                                                                                                                              |
| ---------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `HOST`                 | `0.0.0.0`                    | Interface the HTTP server binds to. Use `127.0.0.1` behind a local proxy                                                                 |
| `PORT`                 | `3000`                       | HTTP port                                                                                                                                |
| `GLOBAL_CONFIG_PATH`   | `./config/config.toml`       | Global config file (must end in `.toml`)                                                                                                 |
| `CHAINS_DIRECTORY`     | `./config/chains`            | Directory scanned for `*.toml` chain configs (must exist)                                                                                |
| `DB_DIRECTORY`         | `./data`                     | Holds `cosmad.duckdb`, `engine.sock`, `engine.pid`                                                                                       |
| `ENGINE_SOCKET_PATH`   | `<DB_DIRECTORY>/engine.sock` | Unix socket between the processes                                                                                                        |
| `DB_THREADS`           | number of CPUs               | DuckDB threads                                                                                                                           |
| `DB_MEM_LIMIT`         | 20% of RAM (min 1GB)         | DuckDB memory limit, e.g. `2GB`. In containers set it explicitly: Node sees the host's RAM, not the cgroup limit                         |
| `DB_MAX_TEMP_DIR_SIZE` | `1GB`                        | Max DuckDB spill-to-disk size                                                                                                            |
| `NODE_ENV`             | -                            | Must be `production` when running `dist/` (`pnpm start` sets it). Anything else starts Vite dev middleware and skips the built dashboard |

Relative paths resolve against the working directory. Keep `ENGINE_SOCKET_PATH` short
(Unix socket paths are limited to ~100 characters) and on a local filesystem.

## Global config

```toml
serve_api = true          # start the HTTP API process
serve_dashboard = true    # serve the web UI from the API process (requires serve_api = true)

# Optional. Without [cors] any origin is allowed ("*"). Mirrors hono's cors() options.
# [cors]
# origin = ["https://dashboard.example.com"]   # string or list
# allow_methods = ["GET", "HEAD", "OPTIONS"]
# allow_headers = ["X-Custom-Header"]
# expose_headers = ["Content-Length"]
# max_age = 600
# credentials = false

# Optional. Without [csrf] protection is off; an empty [csrf] enables hono's defaults (same-origin).
# [csrf]
# origin = ["https://dashboard.example.com"]
# sec_fetch_site = ["same-origin", "same-site"]   # same-origin | same-site | none | cross-site

[telegram]   # see notifications.md for all notifiers
enabled = true
bot_token = "CHANGE_ME"
chat_id = "-100000000000"
```

Use one file per chain in the chains directory. (The schema also accepts a `chain_configs` table in
this file, but chain ids containing `-` get mangled by the snake_case -> camelCase conversion, so
it is not recommended.) The chains directory must exist, but may be empty.

## Chain config

The file name is the chain id (`config/chains/cosmoshub-4.toml` -> `cosmoshub-4`). It is used in API
paths and as the database key, so use the real chain id and don't rename it later (that would start a
new, empty history).

Fully commented references listing every setting are in
[`config/examples/bft-chain.example.toml`](../config/examples/bft-chain.example.toml) and
[`config/examples/tm2-chain.example.toml`](../config/examples/tm2-chain.example.toml).
Copy one to `config/chains/<chain-id>.toml` and edit it.

### Durations

Every time setting takes a string with a unit, so you never have to remember whether a field is in
seconds or milliseconds:

| Unit     | Meaning      | Example            |
| -------- | ------------ | ------------------ |
| `ms`     | milliseconds | `"120000ms"`       |
| `s`      | seconds      | `"120s"`, `"1.5s"` |
| `m`      | minutes      | `"2m"`             |
| `h`      | hours        | `"1h"`             |
| `d`, `w` | days, weeks  | `"1d"`, `"2w"`     |

Parts can be chained: `"1h30m"`, `"1m 30s"`. These settings are durations: `poll_interval`,
`health_check_interval`, `endpoint_down_alert_after`, `notify_retry_pause`,
`notify_retry_max_pause`, `stalled_threshold`, `repeat_interval`, `ping` and the CORS `max_age`.

A plain number without a unit still works so existing configs keep their meaning, but it uses the
field's old unit: **milliseconds** for `poll_interval_ms`, **seconds** for all the others. A string
without a unit (`"60"`) is rejected. `poll_interval` is the same setting as `poll_interval_ms`.

### Common fields

| Field                   | Type               | Default | Description                                                                                                          |
| ----------------------- | ------------------ | ------- | -------------------------------------------------------------------------------------------------------------------- |
| `pretty_name`           | string             | -       | Display name                                                                                                         |
| `chain_logo`            | string             | -       | Optional logo URL for the dashboard                                                                                  |
| `chain_type`            | `"bft"` or `"tm2"` | -       | Cosmos SDK/CometBFT, or Gnoland/TM2                                                                                  |
| `rpc_urls`              | array              | -       | At least one. Each is `{ url = "...", alert_if_down = true }`                                                        |
| `api_urls`              | array              | -       | **Required for `bft`**, ignored for `tm2`. Same shape as `rpc_urls`                                                  |
| `poll_interval`         | duration           | `"6s"`  | How often to poll for new blocks. Older name `poll_interval_ms` (bare number = ms) still works                       |
| `range_chunk_size`      | integer            | `25`    | Concurrent commit requests while catching up. Lower for rate-limited RPCs                                            |
| `max_blocks_per_poll`   | integer            | `100`   | Max blocks fetched and stored per poll                                                                               |
| `health_check_interval` | duration           | `"1m"`  | Time between endpoint health checks                                                                                  |
| `allow_block_gaps`      | boolean            | `false` | **Experimental.** Skip a permanently unfetchable height instead of retrying forever. Enable only until it is skipped |
| `alert_config`          | table              | -       | See below                                                                                                            |

Trailing `/` on URLs is stripped. `alert_if_down = true` makes that endpoint raise
`rpc_down`/`api_down` alerts when unhealthy.

### `bft` fields

| Field             | Description                                                           |
| ----------------- | --------------------------------------------------------------------- |
| `valoper_address` | Operator address (`<prefix>valoper1...`)                              |
| `valcons_address` | Consensus address (`<prefix>valcons1...`), identifies your signatures |

### `tm2` fields

| Field              | Description                |
| ------------------ | -------------------------- |
| `operator_address` | Operator account (`g1...`) |
| `signing_address`  | Validator signing address  |

### `alert_config`

| Field                                | Type / default                                    | Description                                                                                                                                                |
| ------------------------------------ | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `alert_if_inactive`                  | boolean                                           | Alert when the validator is inactive, jailed or tombstoned (bft)                                                                                           |
| `stalled_alert`                      | `{ enabled, stalled_threshold }`                  | Chain tip older than this duration (`"1m"`)                                                                                                                |
| `consecutive_miss_alert`             | `{ enabled, threshold, repeat, repeat_interval }` | N missed **blocks** in a row; `repeat_interval` is a duration (`"5m"`)                                                                                     |
| `percentage_missed_blocks_alert`     | `{ enabled, threshold, repeat }`                  | % missed over the signing window. `0.5 < threshold <= 95`. With `repeat`, re-alerts as the threshold is exceeded further                                   |
| `endpoint_down_alert_after`          | duration, `"3m"`                                  | How long an endpoint must stay unhealthy before alerting. `0s` = first failed check. Real delay can be up to one `health_check_interval` longer            |
| `notify_retry_pause`                 | duration, `"5m"`                                  | Wait before retrying a notification whose send failed 3 times. Doubles with every failed round, see [notifications](notifications.md#delivery-and-retries) |
| `notify_retry_max_pause`             | duration, `"1h"`                                  | Upper limit for that growing pause. Must be >= `notify_retry_pause`                                                                                        |
| `signing_window_size`                | integer, optional                                 | Override the sliding window (blocks). Not recommended for `bft`, the chain's own value is used. `tm2` default 10000                                        |
| `telegram` / `discord` / `pagerduty` | table, optional                                   | Per-chain notifier override, see [notifications](notifications.md)                                                                                         |

Example for a Gnoland (`tm2`) validator:

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

A minimal Cosmos SDK (`bft`) chain config:

```toml
pretty_name = "Cosmos Hub"
chain_type = "bft"
valoper_address = "cosmosvaloper1..."
valcons_address = "cosmosvalcons1..."
rpc_urls = [
  { url = "https://rpc.example.com", alert_if_down = true },
  { url = "https://secondary.rpc.example.com", alert_if_down = false }
]
api_urls = [{ url = "https://api.example.com", alert_if_down = true }]

alert_config = {
  alert_if_inactive = true,
  stalled_alert = { enabled = true, stalled_threshold = "1m" },
  consecutive_miss_alert = { enabled = true, threshold = 50, repeat = true, repeat_interval = "5m" },
  percentage_missed_blocks_alert = { enabled = true, threshold = 10.0, repeat = true }
}
```

### Tuning tips

- Use two or more RPC/API URLs per chain, ideally from different providers.
- Rate limited? Raise `poll_interval`, lower `range_chunk_size` and `max_blocks_per_poll`.
- Set `consecutive_miss_alert.threshold` well below the chain's slashing downtime tolerance, and
  `stalled_threshold` above a few block times.
