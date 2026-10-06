# Deployment

Planora ships Docker Compose for local backend orchestration, Windows launchers,
validation workflows, Fly.io manifests, and a tag-triggered CD workflow. These
artifacts describe an intended deployment path; the audited checkout has concrete
rollout blockers and has not been certified by a production deployment.

Read [Production readiness](production.md) before a release, [Operations](OPERATIONS.md)
for routine commands, and the [2026-10-06 audit](audits/2026-10-06.md) for verification results.

## Deployment artifacts

| Artifact | Actual role |
|---|---|
| [`docker-compose.yml`](../docker-compose.yml) | PostgreSQL, Redis, RabbitMQ, six backend services, gateway; frontend runs separately |
| [`Start-Planora-Local.ps1`](../Start-Planora-Local.ps1) | Infrastructure in Docker; backend, gateway and frontend as host processes |
| [`Start-Planora-Docker.ps1`](../Start-Planora-Docker.ps1) | Infrastructure/backend/gateway in Docker; frontend on host |
| [`tools/Planora.Migrator/`](../tools/Planora.Migrator/) | EF migration CLI, collaboration backfill and reply-column upgrade |
| [`deploy/fly/`](../deploy/fly/) | Nine manifests: gateway, six services, migrator, reserved outbox worker |
| [`deploy/fly/setup.ps1`](../deploy/fly/setup.ps1) | Creates apps discovered from manifests; requires PowerShell 7 |
| [`deploy/fly/set-secrets.ps1`](../deploy/fly/set-secrets.ps1) | Stages a per-app subset from an ignored env file; requires PowerShell 7 |
| [`scripts/Verify-Phase1-Prereqs.ps1`](../scripts/Verify-Phase1-Prereqs.ps1) | Limited account/secret/build checks, not a production acceptance test |
| [`.env.production.example`](../.env.production.example) | Example keys; not loaded automatically by Fly |

## Docker Compose topology

All published ports bind to `127.0.0.1`. Container DNS names only work inside
`planora-network`; host processes use the published ports instead.

| Compose service | Image / Dockerfile | Host → container |
|---|---|---|
| `postgres` | `postgres:16-alpine` | `5433 → 5432` |
| `redis` | `redis:7-alpine` | `6379 → 6379` |
| `rabbitmq` | `rabbitmq:3.13-management-alpine` | `5672 → 5672`, `15672 → 15672` |
| `api-gateway` | `Planora.ApiGateway/Dockerfile` | `5132 → 80` |
| `auth-api` | `Services/AuthApi/Planora.Auth.Api/Dockerfile` | `5031 → 80` |
| `category-api` | `Services/CategoryApi/Planora.Category.Api/Dockerfile` | `5281 → 80`, `5282 → 81` |
| `todo-api` | `Services/TodoApi/Planora.Todo.Api/Dockerfile` | `5100 → 80`, `5101 → 81` |
| `collaboration-api` | `Services/CollaborationApi/Planora.Collaboration.Api/Dockerfile` | `5060 → 80` |
| `messaging-api` | `Services/MessagingApi/Planora.Messaging.Api/Dockerfile` | `5058 → 80` |
| `realtime-api` | `Services/RealtimeApi/Planora.Realtime.Api/Dockerfile` | `5032 → 80` |

The three named data volumes are `postgres_data`, `redis_data`, and
`rabbitmq_data`. Both launchers preserve them, including in `-Clean` mode.
Compose has no frontend service or migrator service.

## Local startup

From the repository root:

```powershell
Copy-Item .env.example .env
# Replace the example values before launching.
.\Start-Planora-Docker.ps1
```

Compose requires `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `RABBITMQ_USER`,
`RABBITMQ_PASSWORD`, `JWT_SECRET`, and `GRPC_SERVICE_KEY`. Share the same JWT
and service-key values across the services. See [Configuration](configuration.md)
for the distinction between Compose variables and ASP.NET configuration keys.

Manual orchestration:

```powershell
docker compose --env-file .env up -d --build
docker compose ps
docker compose logs todo-api --tail=100
npm --prefix frontend ci
npm --prefix frontend run dev
```

**Fresh database caveat:** the tracked Todo migration chain starts with an
alteration of an existing table; its initial schema migration is absent.
Startup chooses `MigrateAsync` when any migration exists, so a brand-new Todo
database cannot be promised to start from the tracked checkout. Reconcile a
complete migration baseline before following the first-user flow. Do not delete
an existing database to work around this. See [Database](database.md).

## Schema initialization and migration runner

| Service | Startup behavior |
|---|---|
| Auth, Category, Messaging, Collaboration | `DatabaseStartup.EnsureReadyAsync`: migrations if present in the assembly, otherwise `EnsureCreatedAsync` |
| Todo | Same helper; tracked migrations select `MigrateAsync`, but the initial migration is missing |
| Realtime | Optional DB registration; no startup schema initialization; migration must be applied separately |

The helper does not disable migrations in Production. The existence of a
pre-deploy migrator step in CD therefore does not imply startup migration is
disabled. `EnsureCreatedAsync` does not maintain an EF migration history or
upgrade an already existing schema.

The migrator selects six names: `auth`, `category`, `todo`, `messaging`,
`realtime`, `collaboration`. It reads ASP.NET connection-string configuration;
there is no `AUTH_DATABASE`-style fallback in the implementation.

```powershell
# Configure ConnectionStrings__<Service>Database in the process first.
dotnet run --project tools/Planora.Migrator -- --all --list-pending
dotnet run --project tools/Planora.Migrator -- --service todo
dotnet run --project tools/Planora.Migrator -- --all
```

`--list-pending` still connects to the DB. It does not create a migration for a
service with no compiled migrations. Before applying anything, the runner
rejects a service if its applied migration history contains IDs absent from the
compiled migration set. This detects missing historical files, not arbitrary
schema/model drift. Services are processed independently; `--all` is not a
transaction spanning six databases. Exit codes: `0` success, `64` invalid
arguments, `70` one or more service operations failed.

Additional operations are `--backfill-collaboration` (Todo and Collaboration
connections required) and `--upgrade-collaboration-replies` (Collaboration
connection required). Review and back up affected data before executing them.

## CI/CD workflow inventory

| Workflow | Trigger / current behavior |
|---|---|
| [`ci.yml`](../.github/workflows/ci.yml) | Push on configured branches and PR to main/develop: Markdown/offline links; .NET restore/build/test; frontend npm ci/lint/types/coverage/build |
| [`e2e.yml`](../.github/workflows/e2e.yml) | Path-filtered PR or manual dispatch: Compose stack, production frontend, Playwright API and Chromium UI projects |
| [`security.yml`](../.github/workflows/security.yml) | Secret/dependency scanning, CodeQL, Trivy, SBOM; frontend SBOM attested on push |
| [`openapi.yml`](../.github/workflows/openapi.yml) | Path-filtered PR or manual: Swagger + Spectral; matrix covers Auth, Category, Todo, Messaging, Realtime, omits Collaboration |
| [`migrations.yml`](../.github/workflows/migrations.yml) | Path-filtered PR or manual: intended SQL artifacts for Auth, Category, Todo, Messaging, Collaboration; omits Realtime |
| [`perf-smoke.yml`](../.github/workflows/perf-smoke.yml) | Manual k6 login/todo-list scenarios; absolute thresholds, no relative-baseline comparison implementation |
| [`cd.yml`](../.github/workflows/cd.yml) | `v*` tag or manual ref: preflight, migration runner, service matrix, gateway, public health smoke |
| [`nuget-vuln-pr.yml`](../.github/workflows/nuget-vuln-pr.yml) | Nightly/manual vulnerability tracking PR; report generation, not package upgrades |

`cd.yml` requires `FLY_API_TOKEN` and serializes production runs with
`cd-fly-prod`. Its service matrix contains Auth, Category, Todo, Messaging,
Realtime, Collaboration; `max-parallel: 1` bounds concurrency but does not
express an explicit dependency DAG or guarantee matrix execution order.
Gateway deployment waits for the matrix. Blue/green deployment and health smoke
are requested; database rollback is not automated. Pushing `main` alone does
not trigger CD.

## Confirmed rollout blockers

| Blocker | Evidence | Required correction before release |
|---|---|---|
| Incomplete Todo migration history | Earliest tracked migration alters `todo.user_todo_view_preferences` | Restore/baseline complete schema history and validate against an empty PostgreSQL DB |
| Migrator container omits project dependencies | Dockerfile copies four service trees; csproj also references Realtime/Collaboration | Align Docker build context with the actual project-reference graph |
| Migration artifact job is not self-contained | EF CLI 9.0.15 with EF runtime 10; `--no-build` without a preceding build | Align tool version, build assemblies, include Realtime and validate SQL output |
| Production gateway uses local targets | `Program.cs` selects `ocelot.Docker.json` only for Docker; Production selects tracked `ocelot.json` with loopback targets | Supply verified production routes and service addresses |
| Listener/proxy port alignment unverified | Fly `internal_port=8080`; committed Kestrel endpoints use local ports | Configure/test effective Kestrel REST and HTTP/2 endpoints, not just `ASPNETCORE_URLS` |
| Realtime DB secret omitted | `set-secrets.ps1` lacks RealtimeDatabase in Realtime and migrator matrices | Stage the correct connection on both; apply Realtime migrations |
| Reserved worker included in manifest validation | Outbox worker manifest refers to absent `tools/Planora.Outbox.Worker/Dockerfile` | Separate reserved topology from runnable deployment inputs |
| Production frontend target absent | No frontend Dockerfile/Fly app/CD step | Choose and document a concrete Next.js hosting/build path |

The bootstrap scripts and prerequisite checker do not validate these blockers.
An exit code of zero from that checker is not sufficient release evidence.

## Health endpoints and their limits

All seven HTTP hosts map `/health/live`, `/health/ready`, and `/health` through
[`HealthCheckExtensions.cs`](../BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Extensions/HealthCheckExtensions.cs).

| Endpoint | Evaluates | Interpretation |
|---|---|---|
| `/health/live` | Checks tagged `live` | With no matching checks, returns healthy; proves HTTP host answers |
| `/health/ready` | Checks tagged `ready` | Only registered/tagged dependencies; not an end-to-end business test |
| `/health` | All registered health checks | Aggregate status, default plaintext response |

`AddDatabaseHealthCheck` tags Npgsql as ready. Gateway and Realtime register
empty health-check sets, so their ready response cannot establish downstream,
Redis, broker, or notification-schema health. Inspect service registrations
before treating any probe as a dependency check.

Gateway aggregate aliases include `/auth/health`, `/categories/health`,
`/todos/health`, `/collaboration/health`, `/messaging/health`, `/realtime/health`.
Compose probes `/health/ready`; launchers and some workflows probe aggregate
`/health`. Do not infer notification delivery, permissions or migration
completeness from a successful gateway probe.

## Related references

- [Fly manifests and script limitations](../deploy/fly/README.md)
- [Production release acceptance](production.md)
- [Secrets and rotation](secrets-management.md)
- [Observability](observability.md)
- [Testing and current results](testing.md)
