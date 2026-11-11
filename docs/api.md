# API

The API process serves JSON over HTTP on `HOST:PORT` (default `0.0.0.0:3000`) when
the config holds this setting `serve_api = true`.
All data endpoints are `GET` and read-only. There is **no authentication** for now,
see [operations](operations.md#security).

## Interactive documentation

| URL                 | What                                                   |
| ------------------- | ------------------------------------------------------ |
| `/api/reference`    | [Scalar](https://scalar.com) API reference             |
| `/api/openapi.json` | OpenAPI document, generated from the route definitions |

The reference page loads the Scalar UI from a CDN, so the browser needs internet
access to render it.
The OpenAPI JSON itself is served locally. These are the authoritative,
always-current descriptions of the request/response schemas; the table below is
an overview.

## Endpoints

`{chainId}` is the chain config file name. Unknown chain ids return
`404 {"error": "Chain not found"}`.
Numeric query values outside their range are clamped; non-numeric values are
rejected with `400`. Trailing slashes are ignored.

| Method | Path                                        | Query                                         | Description                                                                                 |
| ------ | ------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------- |
| GET    | `/api/v1/chains`                            | -                                             | `{ "chains": ["cosmoshub-4", ...] }`                                                        |
| GET    | `/api/v1/overview`                          | `days` (1-365, default 30)                    | All chains: status (`online`/`stalled`), latest height, signed %, plus combined daily stats |
| GET    | `/api/v1/chains/{chainId}/stats`            | `days` (1-365, default 30)                    | Total / missed blocks, signed % and per-day breakdown                                       |
| GET    | `/api/v1/chains/{chainId}/blocks/latest`    | -                                             | Latest indexed block, or `null`                                                             |
| GET    | `/api/v1/chains/{chainId}/blocks/recent`    | `limit` (1-500, default 100)                  | Most recent blocks, newest first                                                            |
| GET    | `/api/v1/chains/{chainId}/blocks/{height}`  | -                                             | One block, or `null` if not indexed                                                         |
| GET    | `/api/v1/chains/{chainId}/alerts`           | `limit` (1-500, default 100), `page` (from 1) | Currently **open** alerts                                                                   |
| GET    | `/api/v1/chains/{chainId}/alerts/{alertId}` | -                                             | One alert (open or closed), `404` if unknown                                                |
| GET    | `/api/v1/events`                            | -                                             | Server-Sent Events stream                                                                   |
| GET    | `/api/reference`, `/api/openapi.json`       | -                                             | Docs, see above                                                                             |

### Block

```json
{
  "height": "1234567",
  "hash": "ab12...",
  "time": "2026-10-11T18:00:00.000Z",
  "signed": 1,
  "signature": "ff00...",
  "precommitted": true
}
```

`signed`: `1` signed, `0` active but missed, `-1` not in the active set.
`height` is a string (heights can exceed JS safe integers).
`hash` is hex for `bft`, base64 for `tm2`.
`precommitted` refers to weather the validator has received the block proposal
on time. If it is false and the validator did sign it could mean validator might
have some problems with connection to other peers. It is empty if the validator
didn't sign the block

### Alert

```json
{
  "alertId": "...",
  "chainId": "cosmoshub-4",
  "alertType": "rpc_down",
  "subject": "https://rpc.example.com",
  "openedAt": "...",
  "closedAt": null
}
```

`subject` is set for endpoint alerts (the URL), otherwise `null`.

### Server-Sent Events

`GET /api/v1/events` is a long-lived stream. Event names and payloads:

| `event`        | Payload                                            |
| -------------- | -------------------------------------------------- |
| `block`        | `{ type, chainId, data: Block }`                   |
| `alert_opened` | `{ type, chainId, data: Alert }`                   |
| `alert_closed` | `{ type, chainId, alertId }`                       |
| `chain_status` | `{ type, chainId, status: "online" \| "offline" }` |
| `ping`         | Keep-alive every 15 s                              |

```sh
curl -N http://localhost:3000/api/v1/events
```

When proxying, disable response buffering and use a long read timeout for this path.

## Examples

```sh
curl -s localhost:3000/api/v1/chains
curl -s 'localhost:3000/api/v1/overview?days=7'
curl -s localhost:3000/api/v1/chains/cosmoshub-4/stats?days=30
curl -s 'localhost:3000/api/v1/chains/cosmoshub-4/blocks/recent?limit=20'
curl -s localhost:3000/api/v1/chains/cosmoshub-4/alerts
```

## CORS / CSRF

`/api/*` sends permissive CORS (`*`) unless `[cors]` is configured. CSRF p
rotection is off unless `[csrf]` is present. See [configuration](configuration.md#global-config).

## Other access

The engine's Unix socket (`<DB_DIRECTORY>/engine.sock`) is an internal protocol
between Cosmad's own processes.
Prefer to use the REST API; only use the socket if you are extending Cosmad itself.
