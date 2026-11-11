# COSMAD documentation

| Document                                 | What is in it                                                  |
| ---------------------------------------- | -------------------------------------------------------------- |
| [Getting started](getting-started.md)    | Build from source and run for the first time                   |
| [How it works](architecture.md)          | Processes, data flow, database, alert lifecycle                |
| [Configuration](configuration.md)        | Environment variables, `config.toml`, per-chain files, alerts  |
| [Notifications](notifications.md)        | Telegram, Discord, PagerDuty, Healthchecks setup               |
| [API](api.md)                            | REST endpoints, SSE stream, OpenAPI / Scalar reference         |
| [Docker / Compose](deploy-docker.md)     | Run in a container                                             |
| [systemd](deploy-systemd.md)             | Run as a Linux service                                         |
| [Kubernetes](deploy-kubernetes.md)       | Run in a cluster                                               |
| [Operations](operations.md)              | Security, reverse proxy, backups, upgrades, troubleshooting    |
| [Migrations](migrations.md)              | DuckDB 2.0 database format change and how to convert old data  |

Ready-to-use files live in [`deploy/`](../deploy), the `Dockerfile` and `docker-compose.yml`
at the repository root, and example configs in [`config/`](../config).
