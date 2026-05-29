# Planora Documentation

The project knowledge base for users, developers, operators, and
contributors. Every page documents behaviour that is observable in code,
configuration, tests, scripts, CI, or shipped artefacts.

> If a behaviour is not confirmed by project files, the docs mark it as
> "not confirmed by code" or "requires owner clarification" instead of
> inventing a contract.

## Pick your reading path

| Reader | Start here | Then read |
|---|---|---|
| First-time user | [`getting-started.md`](getting-started.md) | [`features.md`](features.md), [`troubleshooting.md`](troubleshooting.md), [`faq.md`](faq.md) |
| Frontend developer | [`overview.md`](overview.md) | [`features.md`](features.md), [`API.md`](API.md), [`development.md`](development.md), [`testing.md`](testing.md) |
| Backend developer | [`architecture.md`](architecture.md) | [`API.md`](API.md), [`database.md`](database.md), [`auth-security.md`](auth-security.md), [`INVARIANTS.md`](INVARIANTS.md) |
| Operator / on-call | [`OPERATIONS.md`](OPERATIONS.md) | [`configuration.md`](configuration.md), [`deployment.md`](deployment.md), [`production.md`](production.md), [`secrets-management.md`](secrets-management.md), [`observability.md`](observability.md), [`slo.md`](slo.md) |
| Security reviewer | [`auth-security.md`](auth-security.md) | [`security-idor-coverage.md`](security-idor-coverage.md), [`secrets-management.md`](secrets-management.md), [`INVARIANTS.md`](INVARIANTS.md) |
| Contributor | [`codebase-map.md`](codebase-map.md) | [`development.md`](development.md), [`testing.md`](testing.md), [`../CONTRIBUTING.md`](../CONTRIBUTING.md), [`INVARIANTS.md`](INVARIANTS.md) |
| Architect | [`architecture.md`](architecture.md) | [`INVARIANTS.md`](INVARIANTS.md), [`DECISIONS/`](DECISIONS/), [`caching.md`](caching.md) |

## Documentation map

### Product

| File | Purpose |
|---|---|
| [`overview.md`](overview.md) | Product, domain model, scenarios, boundaries |
| [`features.md`](features.md) | Feature behaviour with code references |
| [`getting-started.md`](getting-started.md) | Local setup, first successful path |
| [`faq.md`](faq.md) | Common user / developer questions |
| [`troubleshooting.md`](troubleshooting.md) | Known startup and runtime failures, fixes |
| [`glossary.md`](glossary.md) | Project terms with file references |

### Architecture & code

| File | Purpose |
|---|---|
| [`architecture.md`](architecture.md) | Service boundaries, data flow, patterns, diagrams |
| [`codebase-map.md`](codebase-map.md) | Directory and critical-file map |
| [`INVARIANTS.md`](INVARIANTS.md) | Closed-form rules enforced across the codebase |
| [`API.md`](API.md) | Gateway route map and endpoint reference |
| [`database.md`](database.md) | EF Core contexts, tables, schema bootstrap |
| [`caching.md`](caching.md) | Cache layers, naming, TTL, invalidation |
| [`DECISIONS/`](DECISIONS/) | Architecture Decision Records (ADRs) |

### Security

| File | Purpose |
|---|---|
| [`auth-security.md`](auth-security.md) | Auth model, CSRF, JWT, sessions, security stamp |
| [`security-idor-coverage.md`](security-idor-coverage.md) | IDOR-resistant endpoints and the tests that pin them |
| [`secrets-management.md`](secrets-management.md) | Secret inventory, storage, rotation |
| [`../SECURITY.md`](../SECURITY.md) | Vulnerability disclosure policy |

### Operations

| File | Purpose |
|---|---|
| [`OPERATIONS.md`](OPERATIONS.md) | Runbook entry point |
| [`configuration.md`](configuration.md) | Environment variables, appsettings, ports |
| [`deployment.md`](deployment.md) | Docker Compose, CI/CD, Fly deployment |
| [`production.md`](production.md) | Production baseline, readiness checklist |
| [`observability.md`](observability.md) | OpenTelemetry, Loki, Grafana, custom metrics |
| [`slo.md`](slo.md) | Service-level objectives and error budgets |

### Engineering workflow

| File | Purpose |
|---|---|
| [`development.md`](development.md) | Local workflows for adding features, endpoints, components |
| [`testing.md`](testing.md) | Suites, commands, coverage, OpenAPI lint |
| [`../CONTRIBUTING.md`](../CONTRIBUTING.md) | PR checklist, branch hygiene, CODEOWNERS |
| [`../CHANGELOG.md`](../CHANGELOG.md) | Released changes, conventional-commit log |

## Key code references

| Topic | Files |
|---|---|
| Gateway routes | `Planora.ApiGateway/ocelot.json`, `Planora.ApiGateway/ocelot.Docker.json` |
| Frontend API client | `frontend/src/lib/api.ts`, `frontend/src/lib/auth-public.ts`, `frontend/src/lib/csrf.ts`, `frontend/src/store/auth.ts` |
| Auth endpoints | `Services/AuthApi/Planora.Auth.Api/Controllers` |
| Todo endpoints & sharing | `Services/TodoApi/Planora.Todo.Api/Controllers/TodosController.cs`, `Services/TodoApi/Planora.Todo.Application/Features/Todos` |
| Category endpoints | `Services/CategoryApi/Planora.Category.Api/Controllers/CategoriesController.cs` |
| Messaging endpoints | `Services/MessagingApi/Planora.Messaging.Api/Controllers/MessagesController.cs` |
| Realtime endpoints & hubs | `Services/RealtimeApi/Planora.Realtime.Api/Controllers`, `Services/RealtimeApi/Planora.Realtime.Api/Hubs` |
| Database models | `*/Infrastructure/Persistence/*DbContext.cs`, `*/Infrastructure/Persistence/Configurations` |
| Backend tests | `tests/Planora.UnitTests`, `tests/Planora.ErrorHandlingTests` |
| Frontend tests | `frontend/src/test`, `frontend/playwright.config.ts`, `frontend/e2e` |
| Observability wiring | `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Logging/TelemetryConfiguration.cs`, `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Observability/PlanoraMetrics.cs` |
| Health probes | `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Extensions/HealthCheckExtensions.cs` |
| Migration runner | `tools/Planora.Migrator/`, `.github/workflows/migrations.yml` |
| Fly.io deployment | `deploy/fly/`, `deploy/fly/README.md` |
| Continuous delivery | `.github/workflows/cd.yml` |
| Loki Serilog sink | `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Logging/SerilogConfiguration.cs` (`TryAddLokiSink`) |
| Frontend trace propagation | `frontend/src/lib/trace.ts`, axios interceptor in `frontend/src/lib/api.ts` |
| Performance baseline | `perf/k6/`, `perf/README.md`, `.github/workflows/perf-smoke.yml` |

## Maintenance checklist

Update docs when changing:

- gateway routes or controller actions;
- DTOs, validators, response wrappers, or error behaviour;
- environment variables, ports, scripts, Docker Compose, or appsettings;
- database entities, EF configurations, schema bootstrap, indices, or seed data;
- frontend routes, auth-token handling, API-client behaviour, hidden-task behaviour;
- tests, CI jobs, security checks, or launch scripts;
- production deployment assumptions, secret names, license terms, or vulnerability disclosure policy.
