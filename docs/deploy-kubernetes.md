# Kubernetes

Manifests are in [`deploy/k8s/`](../deploy/k8s), applied in filename order:

| File                     | Contents                                                        |
| ------------------------ | --------------------------------------------------------------- |
| `00-namespace.yaml`      | `cosmad` namespace                                              |
| `10-config.yaml`         | `Secret` with `config.toml`, `ConfigMap` with chain files       |
| `20-storage.yaml`        | 10Gi `PersistentVolumeClaim` for the database                   |
| `30-deployment.yaml`     | The Deployment (1 replica, `Recreate`)                          |
| `40-service.yaml`        | ClusterIP service on port 80                                    |
| `50-ingress.yaml.example`| Ingress with basic auth and SSE-friendly annotations            |

## Deploy

```sh
# 1. edit image in 30-deployment.yaml, your config in 10-config.yaml
#    (or create them from your real files instead of keeping secrets in git:)
kubectl apply -f deploy/k8s/00-namespace.yaml
kubectl -n cosmad create secret generic cosmad-config --from-file=config.toml=config/config.toml
kubectl -n cosmad create configmap cosmad-chains --from-file=config/chains/
kubectl apply -f deploy/k8s/20-storage.yaml -f deploy/k8s/30-deployment.yaml -f deploy/k8s/40-service.yaml
# (apply 10-config.yaml instead of the two create commands if you prefer the manifests)

kubectl -n cosmad logs -f deploy/cosmad
kubectl -n cosmad port-forward svc/cosmad 3000:80
```

Config changes need a restart: `kubectl -n cosmad rollout restart deploy/cosmad`
(note that the `subPath` mount for `config.toml` does not live-update either way).

## Design constraints

- **Exactly one replica.** DuckDB allows a single read-write process per file. Scaling out is not
  supported, and neither is mounting the same volume in two pods. The Deployment uses
  `strategy: Recreate` so the old pod releases the file before the new one starts.
- **Storage:** needs a `ReadWriteOnce` volume on a real block/local filesystem. Avoid NFS/SMB,
  DuckDB and the engine's Unix socket (`/var/lib/cosmad/engine.sock`) need POSIX semantics.
  `fsGroup: 1000` makes the volume writable for the non-root user.
- **Memory:** Node sees node RAM rather than the pod limit. Set `DB_MEM_LIMIT` (e.g. `1GB`) to
  comfortably below `resources.limits.memory`.
- **Probes:** all three use `/api/v1/chains` (requires `serve_api = true`). The startup probe allows
  up to 6 minutes because the engine can replay a long write-ahead log after an unclean stop.
- **Egress:** the pod needs outbound HTTPS to your RPC/API endpoints and notifiers.
- **Auth:** there is none. Don't expose the Service publicly without protecting the ingress
  (see `50-ingress.yaml.example`, and [operations](operations.md#security)).
- **SSE:** `/api/v1/events` is a long-lived stream. Disable proxy buffering and raise read timeouts
  on the ingress for it, or the dashboard's live updates will stall.
- **Backups:** snapshot the PVC (VolumeSnapshot) or see [operations](operations.md#backups).
