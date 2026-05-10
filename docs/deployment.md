# Deployment

Planora has confirmed local/container orchestration, validation CI, Docker-backed e2e, and a production baseline. A concrete production hosting target and deploy/promotion workflow are not defined in the repository.

## Confirmed Deployment Artifacts

| Artifact | Purpose |
|---|---|
| `docker-compose.yml` | local multi-service backend + infrastructure |
| `Services/*/Dockerfile` | backend service images |
| `Planora.ApiGateway/Dockerfile` | gateway image |
| `Start-Planora-Docker.ps1` | local Docker backend launcher |
| `.github/workflows/ci.yml` | documentation/backend/frontend validation CI |
| `.github/workflows/e2e.yml` | Docker-backed Playwright e2e workflow |
| `.github/workflows/security.yml` | security checks |
| `.github/dependabot.yml` | dependency update automation |
| `.env.production.example` | production-oriented secret/config template |
| `docs/production.md` | production deployment baseline |
| `docs/secrets-management.md` | secret inventory and rotation guidance |

No Kubernetes manifests, Helm chart, Terraform, cloud deployment workflow, Vercel config, or production reverse-proxy config was found.

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

- Gitleaks;
- NuGet vulnerability check;
- npm audit;
- weekly schedule.

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

Gateway routes:

```text
GET /health
GET /auth/health
GET /todos/health
GET /categories/health
GET /messaging/health
GET /realtime/health
```

Source: `Planora.ApiGateway/ocelot*.json`.

## Deployment Risks

| Risk | Evidence | Mitigation |
|---|---|---|
| No production frontend container | frontend absent from Compose | add deployment target for `frontend` or document external hosting |
| Cookie `Secure` depends on request HTTPS | `AuthenticationController.cs` | enforce HTTPS and forwarded headers in production |
| No production reverse proxy config found | repository scan | document Nginx/Traefik/cloud gateway before deployment |
