# systemd

Files: [`deploy/systemd/cosmad.service`](../deploy/systemd/cosmad.service) and
[`deploy/systemd/cosmad.env.example`](../deploy/systemd/cosmad.env.example).

This is more of a suggestion on how to run it, there are some other alternatives.
This method requires that you have some basic Linux and systemd knowledge.
This guide requires you to have 1 user with sudo privileges and all of this
will be ran with user with no login.

## Install

```sh
# 1. user and directories
sudo useradd --system --home /var/lib/cosmad --shell /usr/sbin/nologin cosmad
sudo install -d -o cosmad -g cosmad -m 0750 /var/lib/cosmad
sudo install -d -m 0755 /etc/cosmad /etc/cosmad/chains /opt/cosmad

# 2. build and install the app (Node 24 + pnpm required)
git clone https://github.com/Cogwheel-Validator/cosmad.git && cd cosmad
pnpm install --frozen-lockfile && pnpm build
sudo cp -r dist package.json pnpm-lock.yaml pnpm-workspace.yaml /opt/cosmad/
(cd /opt/cosmad && sudo pnpm install --frozen-lockfile --prod --ignore-scripts)
sudo chown -R root:root /opt/cosmad

# 3. configuration (readable by the service user, keep secrets private)
sudo install -m 0640 -o root -g cosmad config/config.toml /etc/cosmad/config.toml
sudo install -m 0640 -o root -g cosmad config/chains/*.toml /etc/cosmad/chains/
sudo install -m 0644 deploy/systemd/cosmad.env.example /etc/cosmad/cosmad.env

# 4. service
sudo install -m 0644 deploy/systemd/cosmad.service /etc/systemd/system/cosmad.service
sudo systemctl daemon-reload
sudo systemctl enable --now cosmad
```

> The production install is needed because the backend bundle keeps dependencies external
> (`--packages=external`): `/opt/cosmad/node_modules` must exist next to `dist/`.

Edit `/etc/cosmad/cosmad.env` as needed; the example binds to `127.0.0.1` for use with a reverse proxy.
If `node` is not at `/usr/bin/node` (nvm, fnm, ...) fix `ExecStart`.

## Operate

### Check status

```sh
sudo systemctl status cosmad
sudo journalctl -u cosmad -f
```

### Update project

In case there is some kind of update you want to collect:

```sh
git fetch --all && git checkout DESIRED_VERSION # switch the DESIRED_VERSION with real git tag
pnpm install --frozen-lockfile && pnpm build
sudo cp -r dist package.json pnpm-lock.yaml pnpm-workspace.yaml /opt/cosmad/
(cd /opt/cosmad && sudo pnpm install --frozen-lockfile --prod --ignore-scripts)
sudo systemctl restart cosmad
```

### Update config or add a new chain

In the place you initially cloned the repos. After adding, removing or just modifying
the configuration files then reapply them using the commands down below.

```sh
sudo install -m 0640 -o root -g cosmad config/config.toml /etc/cosmad/config.toml
sudo install -m 0640 -o root -g cosmad config/chains/*.toml /etc/cosmad/chains/
# after changing configs restart to take in the effect
sudo systemctl restart cosmad
```

## Notes

- The runner supervises three child processes; if one dies it stops the rest and exits non-zero,
  and `Restart=on-failure` brings everything back.
- `TimeoutStartSec=360`: after an unclean shutdown the engine may replay a large DuckDB write-ahead log
  for minutes before reporting ready.
- `ReadWritePaths=/var/lib/cosmad` is the only writable location; keep `DB_DIRECTORY` there.
