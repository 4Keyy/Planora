<div align="center">

# 🗂️ Planora

**A personal productivity & task‑collaboration platform — built as a production‑grade .NET 9 microservices backend behind an Ocelot API gateway, with a Next.js 15 frontend.**

[![CI](https://github.com/4Keyy/Planora/actions/workflows/ci.yml/badge.svg?branch=develop)](https://github.com/4Keyy/Planora/actions/workflows/ci.yml)
[![Security](https://github.com/4Keyy/Planora/actions/workflows/security.yml/badge.svg?branch=develop)](https://github.com/4Keyy/Planora/actions/workflows/security.yml)
[![.NET](https://img.shields.io/badge/.NET-9.0-512BD4?logo=dotnet&logoColor=white)](https://dotnet.microsoft.com/)
[![Next.js](https://img.shields.io/badge/Next.js-15-000000?logo=nextdotjs&logoColor=white)](https://nextjs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

[Overview](docs/overview.md) · [Architecture](docs/architecture.md) · [API](docs/API.md) · [Database](docs/database.md) · [Features](docs/features.md) · [Invariants](docs/INVARIANTS.md)

</div>

---

## ✨ What is Planora?

Planora lets people organize personal tasks, share them with friends, collaborate through a per‑task comment timeline ("ветки"), and stay in sync through real‑time notifications. It is engineered as a **clean, observable, secure microservices system** where every service owns its own data and talks to its peers through typed gRPC contracts and a reliable RabbitMQ event bus.

## 🧭 Architecture at a glance

```text
                          ┌──────────────────┐
        Browser ───HTTP──▶│  Ocelot Gateway  │  JWT · rate limit · CORS · health
                          └────────┬─────────┘
             ┌─────────────┬───────┼────────────┬──────────────┬───────────────┐
             ▼             ▼       ▼            ▼              ▼               ▼
        ┌─────────┐  ┌─────────┐ ┌──────────┐ ┌───────────┐ ┌──────────────┐ ┌──────────┐
        │  Auth   │  │  Todo   │ │ Category │ │ Messaging │ │ Collaboration│ │ Realtime │
        │  API    │  │  API    │ │   API    │ │    API    │ │     API      │ │   API    │
        └────┬────┘  └────┬────┘ └────┬─────┘ └─────┬─────┘ └──────┬───────┘ └────┬─────┘
             │            │           │             │              │              │
          auth_db      todo_db     category_db   messaging_db  collaboration_db  (Redis)
             └────────── gRPC (x‑service‑key) ──────────┴──── RabbitMQ event bus ─┘
```

Each service is a vertical slice — **Domain → Application → Infrastructure → Api** — and shares cross‑cutting concerns (logging, telemetry, error handling, outbox/inbox, auth, caching) through `BuildingBlocks`.

| Service | Responsibility | Data store |
|---|---|---|
| **API Gateway** (`Planora.ApiGateway`) | Ocelot ingress: JWT validation, rate limiting, CORS, health routing | — |
| **Auth API** | Identity, sessions, JWT/refresh tokens, 2FA, friendships, analytics intake | `planora_auth_db` |
| **Todo API** | Tasks, sharing, hidden/viewer state, workers; publishes task‑lifecycle events | `planora_todo` |
| **Category API** | User categories with color/icon/order | `planora_category` |
| **Messaging API** | Direct user‑to‑user messages | `planora_messaging` |
| **Collaboration API** | Task comment timeline ("ветки"): user/genesis/system comments + notifications | `planora_collaboration` |
| **Realtime API** | SignalR notifications with a Redis backplane | Redis only |
| **Frontend** | Next.js 15 App Router, Zustand state, Axios API client | — |

## 🛠️ Tech stack

| Layer | Technologies |
|---|---|
| **Backend** | .NET 9 · ASP.NET Core · EF Core · MediatR (CQRS) · FluentValidation · AutoMapper |
| **Data & messaging** | PostgreSQL · Redis · RabbitMQ · gRPC (internal) · Outbox/Inbox |
| **Gateway** | Ocelot |
| **Frontend** | Next.js 15 · React 19 · TypeScript · Tailwind CSS · Zustand · Axios |
| **Observability** | OpenTelemetry · Serilog (structured, correlation‑enriched) |
| **Quality & security** | xUnit · Moq · NetArchTest · Playwright · Vitest · CodeQL · Trivy · gitleaks |
| **Delivery** | Docker · Docker Compose · GitHub Actions · Fly.io manifests |

## 🔐 Engineering principles

Planora holds itself to a set of **closed‑form [architectural invariants](docs/INVARIANTS.md)**, including:

- **Database‑per‑service** — no service reads another's tables; cross‑service reads go through gRPC or events.
- **Identity owned by Auth only** — every service validates the shared JWT locally and honours security‑stamp revocation.
- **Reliable messaging** — integration events flow through the **Outbox** pattern; consumers are **idempotent** via the **Inbox** pattern.
- **Defense in depth** — gateway JWT + per‑service JWT, `x‑service‑key` on every gRPC hop, CSRF double‑submit, access tokens in memory only, refresh tokens in httpOnly cookies.

## 🚀 Getting started

### Prerequisites

- [.NET 9 SDK](https://dotnet.microsoft.com/)
- [Node.js 20+](https://nodejs.org/)
- [Docker & Docker Compose](https://docs.docker.com/)

### 1 — Configure secrets

```bash
cp .env.example .env
# then set the required values (see Configuration below)
```

### 2 — Start everything with Docker Compose

```bash
docker compose up --build
```

This brings up PostgreSQL, Redis, RabbitMQ, every service, and the gateway. Databases and schemas are created automatically on first run.

### 3 — Run the frontend

```bash
cd frontend
npm install
npm run dev
```

- Frontend → <http://localhost:3000>
- API Gateway → <http://localhost:5132>

> **Local backend without Docker?** Start infra with `docker compose up -d postgres redis rabbitmq`, apply schemas with `dotnet run --project tools/Planora.Migrator -- --all`, then run each service (`dotnet run --project Services/<Service>/...Api`).

## ⚙️ Configuration

Copy `.env.example` → `.env` and set:

| Variable | Purpose |
|---|---|
| `JWT_SECRET` | Shared JWT signing key (**≥ 32 chars**) |
| `GRPC_SERVICE_KEY` | Inter‑service gRPC auth key (**≥ 16 chars**) |
| `POSTGRES_PASSWORD` | PostgreSQL password |
| `REDIS_PASSWORD` | Redis password |
| `RABBITMQ_USER` / `RABBITMQ_PASSWORD` | RabbitMQ credentials |

Full reference: [`docs/configuration.md`](docs/configuration.md) and [`docs/secrets-management.md`](docs/secrets-management.md).

## 🧪 Testing

```bash
# Backend — unit, integration, architecture tests
dotnet test Planora.sln

# Frontend — component/lib/store tests
cd frontend && npm run test

# End‑to‑end — Docker-backed Playwright flows
cd frontend && npm run e2e
```

Continuous integration runs the full matrix on every PR: backend build (`-warnaserror`) + tests, frontend lint/type‑check/test/build, Playwright e2e, EF migration scripts, markdown lint, and a security suite (CodeQL, Trivy, gitleaks, dependency audits, SBOM).

## 📂 Project structure

```text
Planora/
├── Services/                 # One folder per microservice (Domain/Application/Infrastructure/Api)
│   ├── AuthApi/  TodoApi/  CategoryApi/  MessagingApi/  CollaborationApi/  RealtimeApi/
├── BuildingBlocks/           # Shared Domain / Application / Infrastructure
├── GrpcContracts/            # .proto service contracts
├── Planora.ApiGateway/       # Ocelot gateway
├── frontend/                 # Next.js 15 app
├── tools/Planora.Migrator/   # One‑shot EF migration + data‑backfill runner
├── tests/                    # xUnit unit/architecture/error‑handling tests
├── deploy/fly/               # Fly.io deployment manifests
└── docs/                     # Living documentation
```

## 📚 Documentation

| Doc | What's inside |
|---|---|
| [`docs/overview.md`](docs/overview.md) | System overview & feature status |
| [`docs/architecture.md`](docs/architecture.md) | Services, boundaries, request/event flow |
| [`docs/codebase-map.md`](docs/codebase-map.md) | Where everything lives |
| [`docs/database.md`](docs/database.md) | Schemas, ownership, migrations |
| [`docs/API.md`](docs/API.md) | Gateway routes & endpoints |
| [`docs/features.md`](docs/features.md) | Feature‑by‑feature behavior |
| [`docs/testing.md`](docs/testing.md) | Test strategy & coverage |
| [`docs/observability.md`](docs/observability.md) | Logging, metrics, tracing, alerts |
| [`docs/production.md`](docs/production.md) · [`docs/deployment.md`](docs/deployment.md) | Production & deployment |
| [`docs/INVARIANTS.md`](docs/INVARIANTS.md) | Architectural invariants |

## 🤝 Contributing

Contributions are welcome — see [`CONTRIBUTING.md`](CONTRIBUTING.md). Please keep changes consistent with the architectural invariants and update the relevant docs and `CHANGELOG.md`.

## 📄 License

[MIT](LICENSE) © Planora contributors.
