# Deployment

Planora has confirmed local/container orchestration, validation CI, Docker-backed e2e, a production baseline, **Fly.io application manifests** for the chosen production hosting target, and a **standalone migration runner** for governed schema rollouts. A concrete continuous-delivery workflow (`flyctl deploy` from CI on tag) is not yet committed; it is the next deliverable in the engineering roadmap.

## Confirmed Deployment Artifacts

| Artifact | Purpose |
|---|---|
| `docker-compose.yml` | local multi-service backend + infrastructure |
| `Services/*/Dockerfile` | backend service images |
| `Planora.ApiGateway/Dockerfile` | gateway image |
| `tools/Planora.Migrator/` | one-shot EF Core migration runner CLI + Dockerfile |
| `deploy/fly/*.fly.toml` | Fly.io app manifests (gateway, auth, category, todo, messaging, realtime, outbox-worker, migrator) |
| `deploy/fly/README.md` | Fly.io deployment template walkthrough |
| `Start-Planora-Docker.ps1` | local Docker backend launcher |
| `.github/workflows/ci.yml` | documentation/backend/frontend validation CI |
| `.github/workflows/e2e.yml` | Docker-backed Playwright e2e workflow |
| `.github/workflows/security.yml` | security checks + CycloneDX SBOM artifact |
| `.github/workflows/migrations.yml` | per-PR idempotent SQL migration script artifact |
| `.github/workflows/perf-smoke.yml` | on-demand k6 perf scenarios against the Docker stack |
| `.github/dependabot.yml` | dependency update automation |
| `.env.production.example` | production-oriented secret/config template |
| `docs/production.md` | production deployment baseline |
| `docs/secrets-management.md` | secret inventory and rotation guidance |

No Kubernetes / Helm manifests, Terraform IaC, automated CD workflow, Vercel config, or production reverse-proxy config has been committed yet. The Fly.io manifests document the production shape; the corresponding `flyctl deploy` automation is intentionally deferred until Fly secrets and tokens have been provisioned upstream.

## Docker Compose Topology

| Service | Image/build | Host port(s) |
|---|---|---|
| `postgres` | `postgres:16-alpine` | `127.0.0.1:5433 -> 5432` |
| `redis` | `redis:7-alpine` | `127.0.0.1:6379 -> 6379` |
| `rabbitmq` | `rabbitmq:3.13-management-alpine` | `127.0.0.1:5672 -> 5672`, `127.0.0.1:15672 -> 15672` |
| `auth-api` | `Services/AuthApi/Planora.Auth.Api/Dockerfile` | `5031 -> 80` |
| `category-api` | `Services/CategoryApi/Planora.Category.Api/Dockerfile` | `5281 -> 80`, `5282 -> 81` |
| `todo-api` | `Services/TodoApi/Planora.Todo.Api/Dockerfile` | `5100 -> 80` |
| `messaging-api` | `Services/MessagingApi/Planora.Messaging.Api/Dockerfile` | `5058 -> 80` |
| `realtime-api` | `Services/RealtimeApi/Planora.Realtime.Api/Dockerfile` | `5032 -> 80` |
| `api-gateway` | `Planora.ApiGateway/Dockerfile` | `5132 -> 80` |

The frontend is not part of `docker-compose.yml`; launcher scripts run it locally through npm.

## Docker Startup

```powershell
Copy-Item .env.example .env
# edit .env
.\Start-Planora-Docker.ps1
```

Manual Compose:

```powershell
docker compose --env-file .env up -d --build
```

Health check:

```powershell
docker compose ps
Invoke-WebRequest http://localhost:5132/health
```

## Secrets

Required secrets:

- `POSTGRES_PASSWORD`
- `REDIS_PASSWORD`
- `RABBITMQ_USER`
- `RABBITMQ_PASSWORD`
- `JWT_SECRET`

Do not commit `.env`; `.env.example` and `.env.production.example` are templates only.

## Service Startup Behavior

Auth, Todo, Category, and Messaging wait for PostgreSQL and Redis, then initialize database schema with retry. If user-owned EF migrations exist, startup applies pending migrations; if no migrations exist, startup creates schema from the current EF model. Realtime waits for Redis and RabbitMQ. Todo and Category subscribe to selected integration events during startup.

> **Migration runner status**: the standalone `Planora.Migrator` CLI (in `tools/Planora.Migrator/`) is the chosen runner for governed production rollouts (see [`docs/database.md`](database.md) "Migration Governance" section). Until the CD pipeline lands and explicitly invokes the migrator before each service rollout, services continue to auto-migrate at startup. After cutover, [`docs/INVARIANTS.md`](INVARIANTS.md) `INV-FLOW-4` enforces the new pattern.

Code:

- `Services/AuthApi/Planora.Auth.Api/Program.cs`
- `Services/TodoApi/Planora.Todo.Api/Program.cs`
- `Services/CategoryApi/Planora.Category.Api/Program.cs`
- `Services/MessagingApi/Planora.Messaging.Api/Program.cs`
- `Services/RealtimeApi/Planora.Realtime.Api/Program.cs`
- `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Persistence/DatabaseStartup.cs`
- `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Resilience/DependencyWaiter.cs`

## CI/CD

CI is validation-only. It does not deploy.

`.github/workflows/ci.yml`:

- lint Markdown;
- check local Markdown links in offline mode;
- restore/build/test backend;
- install/lint/type-check/test/build frontend;
- upload coverage artifacts.

`.github/workflows/e2e.yml`:

- generates temporary Docker secrets in `.env.e2e`;
- builds and starts the Compose stack;
- waits for gateway health endpoints;
- runs `npm run e2e` in `frontend`;
- uploads Playwright artifacts;
- tears down the stack.

`.github/workflows/security.yml`:

- Gitleaks secret scan (default ruleset extended by [`.gitleaks.toml`](../.gitleaks.toml) — Planora-specific detectors for JWT/gRPC/Postgres/Redis/RabbitMQ/Email secret patterns, plus an env-var-interpolation allowlist);
- CodeQL SAST (C# and JavaScript/TypeScript, `security-extended` query suite);
- Trivy IaC/Dockerfile misconfiguration scan (SARIF upload);
- NuGet vulnerability check;
- npm audit (`--audit-level=moderate`);
- CycloneDX SBOM artifact (`dotnet CycloneDX` + `@cyclonedx/cyclonedx-npm`), uploaded with 90-day retention;
- weekly schedule.

`.github/workflows/migrations.yml`:

- Matrix-fans across the four DB-owning services (auth, category, todo, messaging);
- Installs `dotnet-ef` 9.0.15;
- Runs `dotnet ef migrations script --idempotent` against each service's Infrastructure project, using safe placeholder connection strings purely so the design-time host can boot;
- Uploads one `.sql` artifact per service with 30-day retention so reviewers see exactly what `Planora.Migrator --all` will execute against production;
- Triggers on PRs touching `Services/**/Migrations/**`, `Services/**/Persistence/**`, `Services/**/Domain/Entities/**`, `BuildingBlocks/.../Persistence/**`, `tools/Planora.Migrator/**`, `Directory.Packages.props`, or this workflow itself.

`.github/workflows/perf-smoke.yml`:

- `workflow_dispatch` only — load runs are not on every PR;
- Stands up the same Docker stack the e2e workflow uses (with freshly-generated secrets in `.env.perf`);
- Waits for gateway health;
- Installs k6 from the official APT repo;
- Runs the chosen scenario (`login`, `todo-list`, or `all`);
- Uploads the k6 summary and raw JSON as a 30-day-retention artifact.

## Production Notes

Production deployment is now formalized as a baseline in [`production.md`](production.md), with secret handling in [`secrets-management.md`](secrets-management.md). It is still not automated by a deployment workflow in the repository. Before deploying beyond local development, define:

| Topic | Required decision |
|---|---|
| TLS | terminate HTTPS and ensure cookies are `Secure` |
| Secret management | inject secrets through a secret store, not `.env` committed to source |
| Network exposure | keep RabbitMQ/Redis/PostgreSQL and service-to-service ports private |
| Frontend hosting | define where Next.js runs and what `NEXT_PUBLIC_API_URL` should be |
| Database migration policy | decide whether services auto-migrate or migrations run as a deployment step |
| Observability | configure OpenTelemetry/Serilog sinks beyond console/file |
| Backup/restore | define PostgreSQL backup schedule and restore playbooks |
| Rollback | define image versioning and DB migration rollback policy |

Use [`.env.production.example`](../.env.production.example) as a key template only. Real production values must come from a secret manager or deployment platform secret store.

## Health Endpoints

Every backend service and the API Gateway expose three probe endpoints, wired by the shared `MapPlanoraHealthEndpoints` extension in `BuildingBlocks.Infrastructure.Extensions.HealthCheckExtensions`:

| Endpoint | Predicate | Use |
|---|---|---|
| `/health/live` | matches health checks tagged `live` (vacuously healthy when none registered) | orchestrator liveness — failure restarts the machine |
| `/health/ready` | matches health checks tagged `ready` (`AddDatabaseHealthCheck` tags Npgsql with `ready`) | orchestrator readiness — failure holds traffic off this instance |
| `/health` | aggregate of every registered check | retained for backwards-compatible consumers (docker-compose healthchecks, ad-hoc curl) |

The Gateway additionally routes the per-service aggregate `/health` paths via Ocelot:

```text
GET /health                  -- gateway aggregate
GET /health/live             -- gateway liveness
GET /health/ready            -- gateway readiness
GET /auth/health
GET /todos/health
GET /categories/health
GET /messaging/health
GET /realtime/health
```

Source: `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Extensions/HealthCheckExtensions.cs`, every `Services/*/Program.cs`, `Planora.ApiGateway/ocelot*.json`.

Fly.io machines use `/health/live` and `/health/ready` for their probes (`deploy/fly/*.fly.toml`).

## Fly.io Deployment Topology

The chosen production hosting target is **Fly.io**. Eight app manifests in [`deploy/fly/`](../deploy/fly/) document the shape:

| App (`fly.toml`) | Role | Concurrency model | Auto-stop |
|---|---|---|---|
| `planora-gateway` | Public edge (Ocelot) | requests (soft 200 / hard 500) | off — edge stays warm |
| `planora-auth` | Internal API | requests (100 / 250) | on |
| `planora-category` | Internal API + gRPC | requests (100 / 250) | on |
| `planora-todo` | Internal API + gRPC | requests (100 / 250) | on |
| `planora-messaging` | Internal API + gRPC | requests (100 / 250) | on |
| `planora-realtime` | SignalR hub | connections (500 / 1000) | off — long-lived sockets |
| `planora-outbox-worker` | Reserved for future outbox extraction | — | off |
| `planora-migrator` | One-shot pre-deploy migration runner | — | (run via `flyctl machine run --rm`) |

Internal addressing uses Fly's `<app>.internal:443` `.flycast` hostnames; gRPC service-key validation runs on top (defense in depth until mTLS via SPIFFE/SPIRE lands). Health probes use `/health/live` + `/health/ready`. Primary region defaults to `ams`.

Required secret matrix per app (set via `flyctl secrets set`):

- Every app: `JwtSettings__Secret`, `GrpcSettings__ServiceKey`, `ConnectionStrings__Redis`, `RabbitMq__HostName`, `RabbitMq__UserName`, `RabbitMq__Password`. Set `OTEL_EXPORTER_OTLP_ENDPOINT` (and `OTEL_EXPORTER_OTLP_HEADERS` if your OTLP collector requires auth) to activate trace + metric export.
- DB-owning apps: their respective `ConnectionStrings__*Database` value (Neon or Fly Postgres).
- `planora-auth`: `Email__Password` only when Gmail SMTP delivery is enabled.
- `planora-todo`, `planora-messaging`: `GrpcServices__AuthApi=https://planora-auth.internal:443`. Todo additionally needs `GrpcServices__CategoryApi=https://planora-category.internal:443`.

Full walkthrough: [`deploy/fly/README.md`](../deploy/fly/README.md).

## Migration Governance

`tools/Planora.Migrator/` ships a console CLI that applies pending EF Core migrations for the four DB-owning services without bringing up the full service host:

```powershell
# List pending migrations against the connection strings in env vars / appsettings:
dotnet run --project tools/Planora.Migrator -- --all --list-pending

# Apply all pending migrations in dependency order:
dotnet run --project tools/Planora.Migrator -- --all

# Apply only one service, with an explicit override:
dotnet run --project tools/Planora.Migrator -- --service auth --connection-string "Host=..."
```

Exit codes: `0` success, `64` bad arguments, `70` one or more services failed. The Dockerfile builds on `mcr.microsoft.com/dotnet/runtime:9.0` — no ASP.NET surface, non-root `appuser`. On Fly.io the intended invocation is `flyctl machine run --rm planora-migrator -- --all` as the pre-deploy step in the eventual CD pipeline.

For PR review, [`.github/workflows/migrations.yml`](../.github/workflows/migrations.yml) attaches a per-service idempotent SQL artifact so reviewers see exactly what the migrator will execute.

## Deployment Risks

| Risk | Evidence | Mitigation |
|---|---|---|
| No production frontend container | frontend absent from Compose | add deployment target for `frontend` or document external hosting |
| Cookie `Secure` depends on `!IWebHostEnvironment.IsDevelopment()` | `AuthenticationController.cs` | enforce HTTPS at the Fly proxy / front door so the cookie is actually transmitted over TLS |
| No CD workflow yet | repository scan | author `.github/workflows/cd.yml` once `FLY_API_TOKEN` is available; use `flyctl deploy --strategy bluegreen --wait-timeout 300` per app |
| Migrator not yet integrated into CD | `tools/Planora.Migrator/`, `deploy/fly/migrator.fly.toml` | add a pre-deploy step that runs `flyctl machine run --rm planora-migrator -- --all` before any service rollout |
| OTLP exporter inactive without endpoint | `OTEL_EXPORTER_OTLP_ENDPOINT` unset | set the env var on every Fly app to a Grafana Cloud / Tempo / OTel-collector OTLP gRPC URL |
