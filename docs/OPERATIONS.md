# Operations Runbook

The operator-facing entry point. For the full background read:

- [`configuration.md`](configuration.md)
- [`deployment.md`](deployment.md)
- [`production.md`](production.md)
- [`secrets-management.md`](secrets-management.md)
- [`troubleshooting.md`](troubleshooting.md)
- [`auth-security.md`](auth-security.md)
- [`observability.md`](observability.md)
- [`slo.md`](slo.md)
- [`caching.md`](caching.md)

## Local Operations

Start Docker backend containers plus local frontend:

```powershell
.\Start-Planora-Docker.ps1
```

Start infrastructure containers plus local .NET backend services:

```powershell
.\Start-Planora-Local.ps1
```

Both scripts preserve data volumes by default.

## Health Checks

Every service exposes three probes ([`docs/deployment.md`](deployment.md)
"Health Endpoints"):

```powershell
# Liveness (process is up; restart on failure)
Invoke-WebRequest http://localhost:5132/health/live

# Readiness (dependencies reachable; hold traffic off on failure)
Invoke-WebRequest http://localhost:5132/health/ready

# Aggregate (backwards-compatible; used by docker-compose healthchecks)
Invoke-WebRequest http://localhost:5132/health
Invoke-WebRequest http://localhost:5132/auth/health
Invoke-WebRequest http://localhost:5132/todos/health
Invoke-WebRequest http://localhost:5132/categories/health
Invoke-WebRequest http://localhost:5132/messaging/health
Invoke-WebRequest http://localhost:5132/realtime/health
```

A `503` on `/health/ready` while `/health/live` returns `200` is an
**intentional traffic hold** — Postgres / Redis / RabbitMQ is unreachable
or warming up. See "Incident Pointers" below for the matching playbook.

## Logs

Launcher transcripts are written under `logs/` by the PowerShell scripts.
Backend services use the Serilog pipeline configured by
`BuildingBlocks.Infrastructure.Logging.SerilogConfiguration`. In production
the same pipeline ships every log line to Grafana Loki via the optional
`TryAddLokiSink` extension when `LOKI_URL` is set
([`observability.md`](observability.md) "Activating Centralized Logs").

Useful local commands:

```powershell
docker compose logs api-gateway --tail=100
docker compose logs auth-api --tail=100
docker compose logs todo-api --tail=100
docker compose ps
```

## Required Secrets

The minimal Docker Compose set:

- `POSTGRES_PASSWORD`
- `REDIS_PASSWORD`
- `RABBITMQ_USER`, `RABBITMQ_PASSWORD`
- `JWT_SECRET` — shared verbatim across every service
- `GRPC_SERVICE_KEY` — shared verbatim across every service

The full production inventory, including the Fly.io secret matrix and
rotation playbook, is in [`secrets-management.md`](secrets-management.md).

## Deployment

The chosen production hosting target is Fly.io. The full deployment shape
is committed: eight manifests under `deploy/fly/`, the bootstrap scripts
under the same directory, and the CD workflow at
`.github/workflows/cd.yml`. See [`deployment.md`](deployment.md) "Bootstrap
workflow — zero to deployable in three commands" for the end-to-end
sequence.

A standard release:

```powershell
git tag v0.2.0
git push --tags
# .github/workflows/cd.yml runs:
#   preflight (FLY_API_TOKEN + fly.toml validation)
#   migrate   (flyctl machine run --rm planora-migrator -- --all)
#   deploy    (services in order, then gateway last, bluegreen)
#   smoke     (poll /health/ready)
```

To redeploy without a new tag (hotfix, rollback to a previous commit):

```powershell
gh workflow run cd.yml --ref <sha-or-branch>
```

## Migration Operations

Run the migrator locally against a dev DB:

```powershell
# Preview pending migrations
dotnet run --project tools/Planora.Migrator -- --all --list-pending

# Apply (uses ConnectionStrings__* from env / appsettings)
dotnet run --project tools/Planora.Migrator -- --all

# Apply for a single service with an explicit connection
dotnet run --project tools/Planora.Migrator `
  -- --service auth --connection-string "Host=..."
```

On Fly.io:

```powershell
flyctl machine run --rm `
  --app planora-migrator `
  --config deploy/fly/migrator.fly.toml `
  --dockerfile tools/Planora.Migrator/Dockerfile `
  -- --all
```

Exit codes: `0` success, `64` bad args, `70` one or more services failed.

For PR review, the `migrations` workflow attaches a per-service idempotent
SQL artifact whenever a schema-relevant path changes; the SQL is exactly
what the migrator will execute against production.

## Observability Operations

Activating exporters is a single secret change per app — no code or
release cycle. See [`observability.md`](observability.md) for the OTLP
and Loki walkthroughs.

Verification:

```powershell
# Read what is set on a given app
flyctl secrets list --app planora-<name>

# Restart so the OTel resource picks up new endpoints
flyctl machine restart --app planora-<name>
```

Custom dashboards / alert rules are listed in
[`observability.md`](observability.md) "Suggested Alerts".

## Incident Pointers

| Incident | First document |
|---|---|
| startup failure | [`troubleshooting.md`](troubleshooting.md#startup-problems) |
| `/health/ready` is `503` but `/health/live` is `200` | [`troubleshooting.md`](troubleshooting.md#startup-problems) (intentional traffic hold during dependency warm-up) |
| auth/session failure | [`troubleshooting.md`](troubleshooting.md#authentication-problems) |
| config drift | [`configuration.md`](configuration.md) |
| production hardening | [`production.md`](production.md) |
| secret rotation | [`secrets-management.md`](secrets-management.md#rotation-guidance) |
| e2e failure | [`testing.md`](testing.md#playwright-e2e) |
| CD pipeline failure | [`.github/workflows/cd.yml`](../.github/workflows/cd.yml) inline error messages + [`deployment.md`](deployment.md) "CI/CD" |
| migration failure | exit code 70 from `Planora.Migrator`; the per-PR `.sql` artifact is the diff to inspect |
| outbox backpressure | `planora.outbox.message.age` p95 climbing; see SLO-04 in [`slo.md`](slo.md) |
| gRPC service-key mismatch | `planora.grpc.unauthenticated{reason="mismatch"}` is non-zero — credential drift; see [`secrets-management.md`](secrets-management.md) `GRPC_SERVICE_KEY` row |
| CSRF spike | `planora.csrf.rejections{reason="mismatch"}` sustained — stale frontend bundle, malicious site, or token-rotation race |
| Grafana Loki silent | `LOKI_URL` likely unset on the affected app; `flyctl secrets list --app planora-<name>` |

## Read also

- [`slo.md`](slo.md) — error-budget targets for the user-visible critical path
- [`caching.md`](caching.md) — what is cached and how it is invalidated
- [`INVARIANTS.md`](INVARIANTS.md) — closed-form rules every change must respect
