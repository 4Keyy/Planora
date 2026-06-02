# Fly.io Deployment Manifests

Per-app `fly.toml` manifests for Planora's production hosting on Fly.io.
These files are **deployment templates** — they do not contain secrets and
they are committed to the repository so the deployment shape is reviewable.

## Layout

| File | App | Role |
|---|---|---|
| `gateway.fly.toml` | `planora-gateway` | Public HTTP edge — Ocelot API Gateway |
| `auth.fly.toml` | `planora-auth` | Auth API |
| `category.fly.toml` | `planora-category` | Category API + gRPC server |
| `todo.fly.toml` | `planora-todo` | Todo API + gRPC server |
| `messaging.fly.toml` | `planora-messaging` | Messaging API + gRPC server |
| `realtime.fly.toml` | `planora-realtime` | Realtime API + SignalR hub |
| `outbox-worker.fly.toml` | `planora-outbox-worker` | Reserved for Phase 4 T4.6 (separate outbox process) |
| `migrator.fly.toml` | `planora-migrator` | Reserved for Phase 1 T1.7 (EF Core migration runner) |

Both placeholder apps reference Dockerfiles that do not yet exist; they are
checked in so the secret-set conventions and naming are agreed before
those workstreams land.

## Required secrets

Every Planora app reads these via Fly secrets. Set them once per app:

```powershell
flyctl secrets set `
  JwtSettings__Secret=<32-char-random> `
  GrpcSettings__ServiceKey=<32-char-random> `
  --app planora-<app>
```

App-specific secrets:

| App | Extra secrets |
|---|---|
| `planora-auth` | `ConnectionStrings__AuthDatabase`, `Email__Password` (when Gmail SMTP is enabled) |
| `planora-category` | `ConnectionStrings__CategoryDatabase` |
| `planora-todo` | `ConnectionStrings__TodoDatabase`, `GrpcServices__AuthApi=https://planora-auth.internal:443`, `GrpcServices__CategoryApi=https://planora-category.internal:443` |
| `planora-messaging` | `ConnectionStrings__MessagingDatabase`, `GrpcServices__AuthApi=https://planora-auth.internal:443` |
| `planora-realtime` | (no DB until Phase 2 T2.5) |
| `planora-gateway` | None beyond the common pair |

Shared infra secrets that every app needs:

```powershell
flyctl secrets set `
  ConnectionStrings__Redis=<upstash-redis-uri> `
  RabbitMq__HostName=<cloudamqp-host> `
  RabbitMq__UserName=<cloudamqp-user> `
  RabbitMq__Password=<cloudamqp-pass> `
  OTEL_EXPORTER_OTLP_ENDPOINT=<grafana-cloud-otlp-url> `
  OTEL_EXPORTER_OTLP_HEADERS="Authorization=Basic <base64-token>" `
  --app planora-<app>
```

## Workflow

1. Create the apps once:
   ```powershell
   flyctl apps create planora-gateway --org <org>
   flyctl apps create planora-auth --org <org>
   # ...one per app
   ```

2. Set the secrets per app (see above).

3. Deploy from CI (preferred) or manually:
   ```powershell
   flyctl deploy --config deploy/fly/gateway.fly.toml `
                 --dockerfile Planora.ApiGateway/Dockerfile `
                 --strategy bluegreen --wait-timeout 300
   ```

## Persistent volumes

`planora-auth` mounts a Fly volume at `/data/uploads` for user-uploaded avatars.
Without it the container filesystem is ephemeral and avatars vanish on every
`fly deploy`. Bootstrap once per region:

```powershell
flyctl volumes create planora_auth_uploads --app planora-auth --region ams --size 3
```

For multi-region replicas, create one volume per region with the same source
name (`planora_auth_uploads`). Fly auto-binds them per machine. The webroot is
configured via `ASPNETCORE_WEBROOT=/data/uploads` in `auth.fly.toml` `[env]`
so Kestrel writes static assets to the volume rather than the container layer.

When PR-4 (Cloudflare R2) lands, this volume becomes a development/fallback
target only — production uploads go directly to R2.

## Postgres tuning

A leaked `DbContext` or a client that crashes mid-transaction can hold a
Postgres connection open indefinitely. Combined with the per-service pool
sizing (`Maximum Pool Size=10`, see T4.4), that quickly starves the pool
and surfaces as cascading `npgsql` timeouts on unrelated requests.

T4.5 applies `idle_in_transaction_session_timeout = 30 s` at the Postgres
side as the backstop:

- **Local (docker-compose)** — wired into the `postgres` service `command`
  in `docker-compose.yml`: `-c idle_in_transaction_session_timeout=30000`.
- **Fly Postgres** — apply once per cluster:

  ```bash
  flyctl postgres config update \
    --app planora-postgres \
    --idle-in-transaction-session-timeout 30000
  ```

  Confirm with `flyctl postgres config show --app planora-postgres`. The
  setting persists across machine restarts and rolls automatically across
  replicas.

30 s leaves plenty of headroom for legitimate long-running batches (the
nightly outbox cleanup, the avatar re-encode worker) while bounding the
worst-case starvation window for the synchronous request pool.

## Notes

- **Internal traffic** uses Fly's `<app>.internal:443` `.flycast` hostnames
  with mTLS terminated by Fly proxy. gRPC service-key validation runs on top
  of this (defense in depth until SPIFFE/SPIRE lands per Phase 3 T3.1).
- **Health probes** use the `/health/live` and `/health/ready` endpoints
  shipped in commit `1bb1df2`. Liveness restarts a wedged machine;
  readiness holds traffic off while dependencies warm up.
- **Auto-stop** is enabled for non-edge apps so idle machines spin down.
  The Gateway has auto-stop disabled (always-on edge).
- **Region** defaults to `ams` (Amsterdam) as the primary. Add a secondary
  later with `flyctl regions add <code> --app planora-<app>`.
