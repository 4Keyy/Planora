<!-- markdownlint-disable-file MD041 -->
<p align="center">
  <img src="docs/assets/logo.svg" alt="Planora" width="72" height="72" />
</p>

<h1 align="center">Planora</h1>

<p align="center">
  Personal productivity platform — task management, categories, friend sharing, and realtime notifications.
</p>

<p align="center">
  <a href="https://github.com/4kkkk/Planora/actions/workflows/ci.yml">
    <img alt="CI" src="https://github.com/4kkkk/Planora/actions/workflows/ci.yml/badge.svg" />
  </a>
  <a href="https://github.com/4kkkk/Planora/actions/workflows/security.yml">
    <img alt="Security Scan" src="https://github.com/4kkkk/Planora/actions/workflows/security.yml/badge.svg" />
  </a>
  <a href="LICENSE">
    <img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg" />
  </a>
  <img alt=".NET" src="https://img.shields.io/badge/.NET-9.0-512BD4?logo=dotnet" />
  <img alt="Next.js" src="https://img.shields.io/badge/Next.js-15-000000?logo=nextdotjs" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript" />
  <img alt="Docker" src="https://img.shields.io/badge/Docker-ready-2496ED?logo=docker" />
</p>

---

Planora is a full-stack personal productivity application built as a **.NET 9 microservice system** with a **Next.js 15** frontend. It combines task management, categories, friendship-based sharing, hidden shared tasks, direct messages, realtime notifications, and account security workflows behind an Ocelot API Gateway.

The repository is not a single monolith — it is a service-oriented codebase with separate ownership for auth, todos, categories, messaging, realtime delivery, and gateway ingress.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 15 (App Router), TypeScript, Tailwind CSS, Zustand, Framer Motion |
| API Gateway | Ocelot, JWT validation, rate limiting, CORS |
| Backend | .NET 9, ASP.NET Core, MediatR (CQRS), EF Core 9, gRPC |
| Messaging | RabbitMQ, SignalR |
| Cache | Redis |
| Database | PostgreSQL |
| Auth | JWT + httpOnly refresh cookies, TOTP 2FA, CSRF double-submit |
| Testing | xUnit, Vitest, Playwright (e2e) |
| CI | GitHub Actions, Gitleaks, `dotnet-vuln`, `npm audit` |

## At A Glance

| Service | Responsibility | Code |
|---|---|---|
| Frontend | Auth, dashboard, todos, categories, profile/security UI | `frontend/src/` |
| API Gateway | Ocelot routing, JWT validation, health, rate limiting | `Planora.ApiGateway/` |
| Auth API | Users, sessions, 2FA, email verification, friendships | `Services/AuthApi/` |
| Todo API | Tasks, status/priority, sharing, hidden state, viewer prefs | `Services/TodoApi/` |
| Category API | Per-user categories with colors, icons, ordering | `Services/CategoryApi/` |
| Messaging API | Direct messages between users | `Services/MessagingApi/` |
| Realtime API | SignalR notification hubs | `Services/RealtimeApi/` |
| Building Blocks | CQRS, Result, repositories, middleware, RabbitMQ, Redis | `BuildingBlocks/` |

## Key Features

- **Account lifecycle** — registration, login, logout, silent token refresh, password reset, email verification, profile update, account deletion.
- **Session security** — access token in frontend memory only, refresh token in an `httpOnly` cookie scoped to `/auth/api/v1/auth`, refresh rotation, session listing/revocation.
- **CSRF protection** — double-submit cookie pattern; `GET /auth/api/v1/auth/csrf-token` issues `XSRF-TOKEN`, state-changing requests send `X-CSRF-Token`.
- **Two-factor authentication** — TOTP setup, confirmation, and disable flows.
- **Todos** — create/update/delete, filter by status/category/completion, due dates, priorities, completed-task view.
- **Sharing** — share with all accepted friends or with selected friends via `sharedWithUserIds`; non-owner viewers have limited update rights.
- **Hidden shared tasks** — per-viewer hidden state redacts task details server-side; the blurred category pill reveals on hover.
- **Categories** — user-scoped CRUD with color, icon, and display order.
- **Friendships** — request by user ID or email, accept/reject/remove, outgoing/incoming request tracking.
- **Messaging & realtime** — direct messages and SignalR notification delivery.
- **Observability** — Serilog structured logging, correlation IDs, health endpoints, RabbitMQ/Redis/PostgreSQL startup probes.

## Requirements

| Tool | Version | Purpose |
|---|---|---|
| .NET SDK | 9.x | Backend services and tests |
| Node.js | 20+ | Frontend and Vitest tests |
| Docker Desktop | latest | PostgreSQL, Redis, RabbitMQ, optional backend containers |
| PowerShell | 7.x recommended | Project launcher scripts |

## Quick Start

### 1. Clone and create the environment file

```powershell
git clone https://github.com/4kkkk/Planora.git
cd Planora
Copy-Item .env.example .env
```

### 2. Fill in the required secrets

```env
POSTGRES_PASSWORD=<strong-password>
REDIS_PASSWORD=<strong-password>
RABBITMQ_USER=planora
RABBITMQ_PASSWORD=<strong-password>
JWT_SECRET=<at-least-32-characters>
```

Generate a strong JWT secret:

```powershell
[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(48))
```

### 3. Start the stack

```powershell
# Docker backend + local frontend (recommended for most development)
.\Start-Planora-Docker.ps1

# Local .NET services + infrastructure in Docker
.\Start-Planora-Local.ps1
```

### 4. Open the app

| Endpoint | URL |
|---|---|
| Frontend | <http://localhost:3000> |
| API Gateway | <http://localhost:5132> |
| Gateway health | <http://localhost:5132/health> |
| RabbitMQ UI | <http://localhost:15672> |

## Manual Commands

```powershell
# Backend
dotnet restore Planora.sln
dotnet build Planora.sln
dotnet test Planora.sln --settings coverage.runsettings

# Frontend
npm --prefix frontend install
npm --prefix frontend run dev
npm --prefix frontend run lint
npm --prefix frontend run type-check
npm --prefix frontend run test
npm --prefix frontend run test:coverage
npm --prefix frontend run build
```

## Project Structure

```text
Planora/
├── BuildingBlocks/          Shared CQRS, Result model, repositories, middleware
├── GrpcContracts/           .proto contracts shared between services
├── Planora.ApiGateway/      Ocelot gateway (routes, auth, rate limiting)
├── Services/
│   ├── AuthApi/             Identity, sessions, 2FA, friendships, analytics
│   ├── TodoApi/             Todo domain, sharing, hidden/viewer preferences
│   ├── CategoryApi/         Categories and category gRPC
│   ├── MessagingApi/        Direct messages
│   └── RealtimeApi/         SignalR hubs, notifications
├── frontend/                Next.js 15 (App Router, TypeScript, Tailwind)
├── tests/                   xUnit backend unit tests
├── docs/                    Full documentation knowledge base
├── .github/workflows/       CI, e2e, and security scan pipelines
└── docker-compose.yml       Full local infrastructure stack
```

## API Surface

The browser calls the API Gateway at `http://localhost:5132`.

| Prefix | Service | Auth |
|---|---|---|
| `/auth/api/v1/auth/*` | Auth — login, register, refresh, logout | public / bearer |
| `/auth/api/v1/users/*` | Auth — profile, sessions, 2FA | bearer |
| `/auth/api/v1/friendships/*` | Auth — friend requests, accept/reject | bearer |
| `/todos/api/v1/todos/*` | Todo API | bearer |
| `/categories/api/v1/categories/*` | Category API | bearer |
| `/messaging/api/v1/messages/*` | Messaging API | bearer |
| `/realtime/*` | Realtime API, SignalR | bearer |

Full reference: [`docs/API.md`](docs/API.md)

## Documentation

| Guide | Description |
|---|---|
| [`docs/overview.md`](docs/overview.md) | Product and domain overview |
| [`docs/getting-started.md`](docs/getting-started.md) | First local run, step by step |
| [`docs/architecture.md`](docs/architecture.md) | Service boundaries, data flow, patterns |
| [`docs/features.md`](docs/features.md) | Feature behavior with code references |
| [`docs/API.md`](docs/API.md) | HTTP endpoint reference |
| [`docs/database.md`](docs/database.md) | PostgreSQL schema, EF Core contexts |
| [`docs/auth-security.md`](docs/auth-security.md) | Auth model, CSRF, JWT, session security |
| [`docs/configuration.md`](docs/configuration.md) | All environment variables and config |
| [`docs/testing.md`](docs/testing.md) | Test suites, commands, coverage |
| [`docs/deployment.md`](docs/deployment.md) | Docker Compose, CI, deployment notes |
| [`docs/production.md`](docs/production.md) | Production deployment checklist |
| [`docs/secrets-management.md`](docs/secrets-management.md) | Secret inventory and rotation guide |
| [`docs/troubleshooting.md`](docs/troubleshooting.md) | Common failures and fixes |

## Troubleshooting

| Symptom | First check |
|---|---|
| `401` after login | All services must share the same `JWT_SECRET`, issuer, and audience |
| `403 CSRF_VALIDATION_FAILED` | Fetch `/auth/api/v1/auth/csrf-token` first; send `X-CSRF-Token` on mutations |
| Docker Compose won't start | `.env` placeholders still present or required secrets missing |
| Redis connection fails | `REDIS_PASSWORD` must match Redis `requirepass` and all connection strings |
| Category data missing on todos | Todo API can't reach Category gRPC — check `GrpcServices__CategoryApi` |
| Shared todos not appearing | Friendship must be accepted; todo must be public or directly shared |

Full guide: [`docs/troubleshooting.md`](docs/troubleshooting.md)

## Contributing

Read [`CONTRIBUTING.md`](CONTRIBUTING.md) and [`docs/development.md`](docs/development.md) before opening a PR.

Please use the issue templates for bug reports and feature requests.

## Security

To report a security vulnerability, see [`SECURITY.md`](SECURITY.md). Do not open a public issue.

## License

Planora is released under the [MIT License](LICENSE).
