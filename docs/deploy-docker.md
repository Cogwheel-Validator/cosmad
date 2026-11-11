# Docker and Docker Compose

The repository ships a multi-stage [`Dockerfile`](../Dockerfile) and a
[`docker-compose.yml`](../docker-compose.yml).

There is also a `docker-compose.dev.yml` file which is useful for development
but requires to manually build the image instead of pulling it from the docker registry.

| Container path            | Purpose                          | Env var (preset in image) |
| ------------------------- | -------------------------------- | ------------------------- |
| `/etc/cosmad/config.toml` | Global config                    | `GLOBAL_CONFIG_PATH`      |
| `/etc/cosmad/chains/`     | Chain configs                    | `CHAINS_DIRECTORY`        |
| `/var/lib/cosmad`         | Database, socket (persist this!) | `DB_DIRECTORY`            |

## Compose

```sh
cp config/config.example.toml config/config.toml     # edit
mkdir -p config/chains                               # add <chain-id>.toml files
docker compose up -d
docker compose logs -f cosmad
```

Compose publishes `127.0.0.1:3000`; put a reverse proxy with authentication in
front of it (see [operations](operations.md#security)).
To expose directly (not recommended) change the port mapping to `"3000:3000"`.

Upgrade:

```sh
git pull
docker compose pull && docker compose down && docker compose up -d
```

## Plain docker

```sh
docker build -t cosmad .
docker run -d --name cosmad --restart unless-stopped \
  -p 127.0.0.1:3000:3000 \
  -v "$PWD/config/config.toml:/etc/cosmad/config.toml:ro" \
  -v "$PWD/config/chains:/etc/cosmad/chains:ro" \
  -v cosmad-data:/var/lib/cosmad \
  -e DB_MEM_LIMIT=2GB \
  cosmad
```

## Notes

- **Memory:** Node reads the host's RAM, not the container limit, so the default
  DuckDB memory limit (20% of host RAM) can exceed a container limit. Set
  `DB_MEM_LIMIT` below `--memory`/`mem_limit`.
- **SELinux** (Fedora, RHEL, OpenSuse): add `:z` to bind mounts (`...:ro,z`) or
  you'll see `EACCES` on `/etc/cosmad/config.toml`.
- **Bind-mounted data dir:** if you use `./data:/var/lib/cosmad` instead of a named
  volume, the directory must be bind mounted (`:rw,z`) if you plan to use it like
  that.
- **Healthcheck** in compose calls `/api/v1/chains`, so it needs `serve_api = true`.
- **Shutdown** takes ~1 s; the runner forwards `SIGTERM` to the engine, which
  closes DuckDB cleanly.
- **Single instance:** never run two containers against the same volume.
- Logs go to stdout (pretty-printed); use `docker logs` or your log driver.
