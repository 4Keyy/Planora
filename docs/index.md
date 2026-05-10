# Planora Documentation

This directory is the project knowledge base for users, developers, operators, and contributors. It documents behavior that is visible in code, configuration, tests, scripts, CI, or existing project files.

> If a behavior is not confirmed by project files, the docs mark it as "not confirmed by code" or "requires owner clarification" instead of inventing a contract.

## Reading Paths

| Reader | Start here | Then read |
|---|---|---|
| First-time user | [`getting-started.md`](getting-started.md) | [`features.md`](features.md), [`troubleshooting.md`](troubleshooting.md) |
| Frontend developer | [`overview.md`](overview.md) | [`features.md`](features.md), [`API.md`](API.md), [`development.md`](development.md) |
| Backend developer | [`architecture.md`](architecture.md) | [`API.md`](API.md), [`database.md`](database.md), [`auth-security.md`](auth-security.md) |
| Operator | [`configuration.md`](configuration.md) | [`deployment.md`](deployment.md), [`production.md`](production.md), [`secrets-management.md`](secrets-management.md), [`troubleshooting.md`](troubleshooting.md) |
| Contributor | [`codebase-map.md`](codebase-map.md) | [`development.md`](development.md), [`testing.md`](testing.md), [`../CONTRIBUTING.md`](../CONTRIBUTING.md) |

## Documentation Map

| File | Purpose | Audience |
|---|---|---|
| [`overview.md`](overview.md) | Product, domain model, scenarios, boundaries | users, developers |
| [`getting-started.md`](getting-started.md) | Requirements, setup, local launch, first successful path | users, developers |
| [`configuration.md`](configuration.md) | Environment variables, appsettings, gateway, frontend config, known caveats | developers, operators |
| [`architecture.md`](architecture.md) | Service boundaries, data flow, patterns, diagrams | developers, architects |
| [`codebase-map.md`](codebase-map.md) | Directory and critical file map | developers, contributors |
| [`features.md`](features.md) | Feature behavior with implementation references | users, developers, QA |
| [`API.md`](API.md) | Gateway route map and endpoint reference | frontend/backend developers |
| [`database.md`](database.md) | PostgreSQL ownership, EF Core contexts, tables, schema bootstrap | backend developers, operators |
| [`auth-security.md`](auth-security.md) | Auth model, CSRF, JWT, sessions, roles, risks | developers, reviewers |
| [`testing.md`](testing.md) | Test suites, commands, coverage setup, manual checks | developers, QA |
| [`deployment.md`](deployment.md) | Docker Compose, CI/CD, production notes | operators, maintainers |
| [`production.md`](production.md) | Production deployment baseline, runtime topology, readiness checklist | operators, maintainers |
| [`secrets-management.md`](secrets-management.md) | Secret inventory, storage rules, rotation guidance | operators, security reviewers |
| [`development.md`](development.md) | Local workflows, adding features/endpoints/components | contributors |
| [`troubleshooting.md`](troubleshooting.md) | Known startup/runtime failures and fixes | everyone |
| [`faq.md`](faq.md) | Common user/developer questions | everyone |
| [`glossary.md`](glossary.md) | Project terms and where they appear in code | everyone |
| [`PRODUCT.md`](PRODUCT.md) | Product-facing summary and user scenarios | users, product owners |
| [`OPERATIONS.md`](OPERATIONS.md) | Operational runbook supplement | operators |
| [`ROADMAP.md`](ROADMAP.md) | Confirmed gaps and recommended next work | maintainers |
| [`DECISIONS/`](DECISIONS/) | Architecture decision records | architects, contributors |

## Source Navigation Rule

This repository includes a generated knowledge graph:

- `graphify-out/GRAPH_REPORT.md`
- `graphify-out/wiki/index.md`
- `graphify-out/graph.json`

For architecture and cross-module questions, check the graph first and use the wiki to decide which raw files to inspect. This is also required by the project-level AGENTS instructions.

## Main Code References

| Topic | Files |
|---|---|
| Gateway routes | `Planora.ApiGateway/ocelot.json`, `Planora.ApiGateway/ocelot.Docker.json` |
| Frontend API client | `frontend/src/lib/api.ts`, `frontend/src/lib/auth-public.ts`, `frontend/src/lib/csrf.ts`, `frontend/src/store/auth.ts` |
| Auth endpoints | `Services/AuthApi/Planora.Auth.Api/Controllers` |
| Todo endpoints and sharing | `Services/TodoApi/Planora.Todo.Api/Controllers/TodosController.cs`, `Services/TodoApi/Planora.Todo.Application/Features/Todos` |
| Category endpoints | `Services/CategoryApi/Planora.Category.Api/Controllers/CategoriesController.cs` |
| Messaging endpoints | `Services/MessagingApi/Planora.Messaging.Api/Controllers/MessagesController.cs` |
| Realtime endpoints/hubs | `Services/RealtimeApi/Planora.Realtime.Api/Controllers`, `Services/RealtimeApi/Planora.Realtime.Api/Hubs` |
| Database models | `*/Infrastructure/Persistence/*DbContext.cs`, `*/Infrastructure/Persistence/Configurations` |
| Tests | `tests/Planora.UnitTests`, `tests/Planora.ErrorHandlingTests`, `frontend/src/test` |
| E2E tests | `frontend/e2e`, `frontend/playwright.config.ts`, `.github/workflows/e2e.yml` |

## Documentation Maintenance Checklist

Update docs when changing:

- gateway routes or controller actions;
- DTOs, validators, response wrappers, or error behavior;
- environment variables, ports, scripts, Docker Compose, or appsettings;
- database entities, EF configurations, schema bootstrap, indexes, or seed data;
- frontend routes, auth token handling, API client behavior, hidden task behavior;
- tests, CI jobs, security checks, or launch scripts.
- production deployment assumptions, secret names, license terms, or vulnerability disclosure policy.

After substantial code/config/test/docs changes, rebuild the knowledge graph according to the repository's Graphify rule.
