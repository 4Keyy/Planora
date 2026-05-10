# Planora

Planora is a personal productivity application built as a .NET 9 microservice system with a Next.js 15 frontend. It combines task management, categories, friendship-based sharing, hidden shared tasks, direct messages, realtime notifications, and account security workflows behind an Ocelot API Gateway.

The repository is not a single monolith. It is a service-oriented codebase with separate ownership for auth, todos, categories, messaging, realtime delivery, and gateway ingress.

## At A Glance

| Area | What exists | Primary code |
|---|---|---|
| Frontend | Next.js App Router UI for auth, dashboard, todos, categories, and profile/security | `frontend/src/app`, `frontend/src/components`, `frontend/src/lib` |
| API Gateway | Ocelot routing, JWT validation, health routes, rate limiting, CORS | `Planora.ApiGateway` |
| Auth API | users, login/register, refresh cookies, sessions, 2FA, email verification, password reset, friendships, analytics event intake | `Services/AuthApi` |
| Todo API | tasks, status/priority, sharing, hidden state, viewer preferences, category enrichment | `Services/TodoApi` |
| Category API | per-user categories with colors, icons, ordering, soft delete | `Services/CategoryApi` |
| Messaging API | direct messages between users | `Services/MessagingApi` |
| Realtime API | SignalR notifications and connection inspection | `Services/RealtimeApi` |
| Shared building blocks | CQRS, Result model, repositories, middleware, logging, health checks, RabbitMQ, Redis, outbox/inbox primitives | `BuildingBlocks` |

## Key Features

- Account lifecycle: registration, login, logout, silent refresh, password reset, email verification, profile update, account deletion.
- Real email delivery: Auth can send verification/reset/security messages through Gmail SMTP when `Email__Provider=GmailSmtp` is configured; local default keeps links in logs.
- Session security: access token in frontend memory, refresh token in an httpOnly `refresh_token` cookie scoped to `/auth/api/v1/auth`, refresh rotation, session listing/revocation.
- Browser CSRF protection: `GET /auth/api/v1/auth/csrf-token` issues a readable `XSRF-TOKEN` cookie, and state-changing requests send `X-CSRF-Token`.
- Two-factor authentication: TOTP setup, confirmation, and disable flows.
- Todos: create, update, delete, filter by status/category/completion, due and expected dates, priorities, completed-task view.
- Sharing: todos can be visible to all accepted friends through the task form's `Share With` all-friends option, or to selected friends through direct `sharedWithUserIds`; non-owner viewers have limited update rights.
- Hidden shared tasks: per-viewer hidden state redacts shared/public task details server-side while preserving category metadata and non-content shared/urgent visual state; the collapsed category pill is visually blurred until hover.
- Categories: user-scoped category CRUD with color, icon, and display order.
- Friendships: friend request by user id or email, incoming/outgoing requests, accept/reject/remove, friend id checks for internal service logic.
- Messaging and realtime notifications: direct messages plus SignalR notification delivery primitives.
- Structured logging and operational checks: Serilog, correlation ids, health endpoints, RabbitMQ/Redis/PostgreSQL startup waiting.

## Who This Project Is For

Planora is useful for:

- users who want a personal task board with category organization and controlled sharing;
- developers studying a .NET microservice architecture with CQRS/MediatR, EF Core, gRPC, RabbitMQ, Redis, Ocelot, and Next.js;
- contributors who need a codebase map, API reference, database reference, testing guide, and security model before changing behavior.

## Requirements

| Tool | Why it is needed | Evidence |
|---|---|---|
| .NET SDK 9.x | builds all backend services and tests | `Directory.Build.props`, `Planora.sln` |
| Node.js + npm | runs the Next.js frontend and Vitest tests | `frontend/package.json` |
| Docker Desktop | local PostgreSQL, Redis, RabbitMQ, and optional backend containers | `docker-compose.yml`, `Start-Planora-*.ps1` |
| PowerShell | project launcher scripts are PowerShell scripts; PowerShell 7.x is recommended and Windows PowerShell is supported by keeping launcher/helper scripts ASCII-compatible | `Start-Planora-Docker.ps1`, `Start-Planora-Local.ps1`, `scripts/*.psm1` |

## Quick Start

1. Create a local environment file.

```powershell
Copy-Item .env.example .env
```

2. Fill the required secrets in `.env`.

Required for Docker Compose:

```env
POSTGRES_PASSWORD=<strong-password>
REDIS_PASSWORD=<strong-password>
RABBITMQ_USER=<user>
RABBITMQ_PASSWORD=<strong-password>
JWT_SECRET=<at-least-32-characters>
```

3. Start the stack.

Docker backend containers plus local frontend:

```powershell
.\Start-Planora-Docker.ps1
```

Infrastructure containers plus local `.NET` backend services and local frontend:

```powershell
.\Start-Planora-Local.ps1
```

Both scripts preserve database volumes by default. Their `-Clean` mode rebuilds code artifacts/images but does not wipe PostgreSQL, Redis, or RabbitMQ volumes.

4. Open the app.

```text
Frontend:    http://localhost:3000
Gateway:     http://localhost:5132
Gateway health: http://localhost:5132/health
RabbitMQ UI: http://localhost:15672
```

## Manual Development Commands

Use the launch scripts for the complete local system. For targeted work:

```powershell
# Backend restore/build/test
dotnet restore Planora.sln
dotnet build Planora.sln
dotnet test Planora.sln --settings coverage.runsettings

# Frontend
Push-Location frontend
npm install
Pop-Location
npm --prefix frontend run dev
npm --prefix frontend run lint
npm --prefix frontend run type-check
npm --prefix frontend run test
npm --prefix frontend run build
```

## Configuration

The main configuration entry points are:

- `.env.example` - environment template for Docker Compose and local scripts.
- `.env.production.example` - production-oriented secret/config key template.
- `docker-compose.yml` - PostgreSQL, Redis, RabbitMQ, backend containers, ports, secrets passed into services.
- `Planora.ApiGateway/ocelot.json` and `Planora.ApiGateway/ocelot.Docker.json` - gateway route map.
- `*/appsettings.json` and `*/appsettings.Docker.json` - service defaults.
- `frontend/next.config.js` and `frontend/src/lib/config.ts` - frontend API base URL normalization and security headers.

See [`docs/configuration.md`](docs/configuration.md) for the full variable table and known configuration caveats.

## Public HTTP Surface

The browser calls the API Gateway by default at `http://localhost:5132`.

| Prefix | Service | Auth |
|---|---|---|
| `/auth/api/v1/auth/*` | Auth API authentication endpoints | mixed public/authenticated |
| `/auth/api/v1/users/*` | Auth API user/profile/admin endpoints | bearer token at gateway; `UsersController.VerifyEmailByToken` is `[AllowAnonymous]` inside the service |
| `/auth/api/v1/friendships*` and `/friendships*` | Auth API friendship endpoints | bearer token |
| `/auth/api/v1/analytics/events` | Auth API allowlisted product events | bearer token + CSRF |
| `/todos/api/v1/todos*` | Todo API | bearer token |
| `/categories/api/v1/categories*` | Category API | bearer token |
| `/messaging/api/v1/messages*` | Messaging API | bearer token |
| `/realtime/*` | Realtime API and SignalR routes | bearer token for protected endpoints |

See [`docs/API.md`](docs/API.md) for endpoint details, request bodies, responses, auth requirements, and code references.

## Project Structure

```text
Planora/
  BuildingBlocks/                 Shared domain, application, and infrastructure primitives
  GrpcContracts/                  .proto contracts shared by services
  Planora.ApiGateway/         Ocelot gateway
  Services/
    AuthApi/                      Identity, sessions, friendships, analytics, auth gRPC
    TodoApi/                      Todo domain, sharing, hidden/viewer preferences, todo gRPC
    CategoryApi/                  Categories and category gRPC
    MessagingApi/                 Direct messages and messaging gRPC
    RealtimeApi/                  SignalR hubs, notifications, realtime gRPC
  frontend/                       Next.js 15 frontend
  tests/                          xUnit backend tests
  docs/                           Documentation knowledge base
  graphify-out/                   Generated knowledge graph and wiki
```

See [`docs/codebase-map.md`](docs/codebase-map.md) for a detailed directory-by-directory map.

## Documentation

Start here:

- [`docs/index.md`](docs/index.md) - documentation home and recommended reading paths.
- [`docs/overview.md`](docs/overview.md) - product and domain overview.
- [`docs/getting-started.md`](docs/getting-started.md) - first local run.
- [`docs/architecture.md`](docs/architecture.md) - system architecture and data flow.
- [`docs/features.md`](docs/features.md) - feature-by-feature behavior.
- [`docs/API.md`](docs/API.md) - HTTP API reference.
- [`docs/database.md`](docs/database.md) - databases, tables, schema bootstrap, ownership.
- [`docs/auth-security.md`](docs/auth-security.md) - authentication and security model.
- [`docs/testing.md`](docs/testing.md) - backend/frontend tests and manual checks.
- [`docs/deployment.md`](docs/deployment.md) - Docker, CI, deployment notes.
- [`docs/production.md`](docs/production.md) - production deployment baseline and readiness checklist.
- [`docs/secrets-management.md`](docs/secrets-management.md) - secret inventory, storage rules, rotation guidance.
- [`docs/troubleshooting.md`](docs/troubleshooting.md) - common failures and fixes.

## Testing

The project has backend xUnit tests, frontend Vitest tests, markdown documentation checks, and a Docker-backed Playwright e2e flow for auth/todos/sharing/hidden viewer behavior.

```powershell
dotnet test Planora.sln --settings coverage.runsettings
npm --prefix frontend run lint
npm --prefix frontend run type-check
npm --prefix frontend run test:coverage
npm --prefix frontend run e2e
```

`npm --prefix frontend run e2e` expects the backend Docker stack to be reachable through `E2E_API_URL` or `http://127.0.0.1:5132`.

CI runs markdown lint/link checks, backend restore/build/test, frontend lint/type-check/test/build, and a separate Docker-backed e2e workflow. See `.github/workflows/ci.yml`, `.github/workflows/e2e.yml`, and [`docs/testing.md`](docs/testing.md).

## Troubleshooting Short List

| Symptom | First check |
|---|---|
| Services return `401` after login | all services must share the same `JwtSettings__Secret`, issuer, and audience |
| Auth POST returns `403 CSRF_VALIDATION_FAILED` | fetch `/auth/api/v1/auth/csrf-token` and send `X-CSRF-Token` on POST/PUT/PATCH/DELETE |
| Docker Compose refuses to start | `.env` placeholders are still present or required secrets are missing |
| Redis connection fails in Docker | `REDIS_PASSWORD` must match Redis `requirepass` and injected connection strings |
| Category data missing on todos | Todo API could not reach Category gRPC; check `GrpcServices__CategoryApi` |
| Friend-visible todos do not appear | friendship must be accepted, the todo must be public or directly shared, and Todo API must reach Auth friendship checks |

Full guide: [`docs/troubleshooting.md`](docs/troubleshooting.md).

## Contributing

Read [`CONTRIBUTING.md`](CONTRIBUTING.md) and [`docs/development.md`](docs/development.md). For architecture work, start from `graphify-out/GRAPH_REPORT.md` and `graphify-out/wiki/index.md` before reading raw files.

## License

Planora is licensed under the MIT License. See [`LICENSE`](LICENSE).
