# Operations

## Security

- **The API has no authentication or TLS.** Anyone who can reach the port can
  read your validator's block history, alert history and the chain list. Bind to
  `127.0.0.1` (`HOST`) and put a reverse proxy in front that terminates TLS and
  authenticates (basic auth, OIDC proxy, VPN/Tailscale-only).
- Config files contain notifier secrets (Telegram token, PagerDuty key, Discord
  webhook). Keep them `0600`/`0640`, out of git (the repo's `.gitignore`
  already excludes `config/**/*.toml`), and use Secrets in Kubernetes or equivalent
  if possible.
- Use `[csrf]` / `[cors]` to restrict origins if the dashboard is served from a
  different host.
- Run as an unprivileged user (all provided deployments do).
- **Alternatively** if you do decide to run in public with no auth,
  you should be mostly fine since this data is kinda already public,
  it is all on the blockchain.
  But do place rate limit in front with TLS by using something like nginx so
  someone doesn't spam the API.

### Reverse proxy (nginx)

```nginx
server {
  listen 443 ssl http2;
  server_name cosmad.example.com;
  # ssl_certificate ...; ssl_certificate_key ...;

  # If you at least want to place a simple
  # auth_basic           "cosmad";
  # auth_basic_user_file /etc/nginx/cosmad.htpasswd;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  # Server-Sent Events: no buffering, long timeout
  location /api/v1/events {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_buffering off;
    proxy_read_timeout 1h;
  }
}
```

## Backups

All state is one DuckDB file, `<DB_DIRECTORY>/cosmad.duckdb` (plus a `.wal`
file next to it while running). Config is not in the database.

- Safest: stop Cosmad, copy `cosmad.duckdb` (and any `.wal`), start again.
  A cold copy of a running database may be inconsistent. In the future this
  process might be simplified and easier to do.
- On Kubernetes/ZFS/LVM use volume snapshots.
- Losing the file only loses history; Cosmad starts empty and keeps monitoring.

Disk use grows with the number of blocks stored per chain (one row per block).
There is no pruning yet; monitor the data volume. `DB_MAX_TEMP_DIR_SIZE` bounds
temporary spill space only.

## Upgrades

1. Read the commit log / release notes for config changes.
2. Rebuild (`pnpm build`, or `docker compose pull && docker compose down &&
docker compose up -d`).
3. Restart. Additive schema changes are applied on start.

## Monitoring Cosmad itself

- Enable the [`[health_check]`](notifications.md#healthchecks-dead-mans-switch)
  heartbeat.
- `GET /api/v1/chains` is a cheap liveness endpoint;
- `GET /api/v1/overview` shows per-chain `online`/`stalled` status.
- Logs are on stdout/journal. Level is `info` in production and `debug` when `NODE_ENV=development`.

## Troubleshooting

| Symptom                                           | Likely cause / fix                                                                                                                                                    |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exits immediately with `Invalid chain config ...` | The log names the field. Check types (numbers vs strings), required fields per `chain_type`, `bft` needs `api_urls`                                                   |
| `ENOENT ... config/chains`                        | `CHAINS_DIRECTORY` doesn't exist, create it (may be empty), and check if the script has permissions                                                                   |
| `For dashboard to work, serveApi must be enabled` | `serve_dashboard = true` with `serve_api = false`                                                                                                                     |
| `EACCES` opening config in a container            | SELinux (use `:z` on mounts) or file permissions for uid 1000                                                                                                         |
| Dashboard is blank / dev server errors            | `NODE_ENV` isn't `production`, or `dist/frontend/dist` is missing (run the full `pnpm build`)                                                                         |
| `engine did not report ready within ...`          | Very large WAL replay or locked DB. Check for a second Cosmad using the same `DB_DIRECTORY`                                                                           |
| Database lock / "could not set lock on file"      | Another process holds `cosmad.duckdb`. Only one instance per data directory                                                                                           |
| Container OOM-killed                              | Set `DB_MEM_LIMIT` below the container memory limit                                                                                                                   |
| No alerts arrive                                  | Check notifier `enabled = true`, logs for `Notifier failed ... after 3 attempts`, and that the global config actually has a notifier (a startup warning says if none) |
| Lots of `rpc_down` flapping                       | Raise `endpoint_down_alert_after`, add more endpoints, or lower `alert_if_down` coverage                                                                              |
| Ingestion lags behind chain                       | Raise `max_blocks_per_poll`, check `range_chunk_size`, or the RPC is rate limiting you                                                                                |
| Blocks stuck at one height forever                | A commit permanently fails to fetch (pruned on all RPCs). See `allow_block_gaps`                                                                                      |
| Stale `engine.pid` warnings                       | Harmless: the runner reaps a leftover engine from an earlier crash                                                                                                    |
