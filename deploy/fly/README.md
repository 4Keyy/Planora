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
