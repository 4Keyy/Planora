# Planora

> A personal productivity and task-collaboration platform, built as a
> production-grade .NET 10 microservices backend behind an Ocelot API gateway,
> with a Next.js 15 frontend.

[![CI](https://github.com/4Keyy/Planora/actions/workflows/ci.yml/badge.svg?branch=develop)](https://github.com/4Keyy/Planora/actions/workflows/ci.yml)
[![Security Scan](https://github.com/4Keyy/Planora/actions/workflows/security.yml/badge.svg?branch=develop)](https://github.com/4Keyy/Planora/actions/workflows/security.yml)
[![.NET 10](https://img.shields.io/badge/.NET-10.0-512BD4?logo=dotnet&logoColor=white)](https://dotnet.microsoft.com/)
[![Next.js 15](https://img.shields.io/badge/Next.js-15-000000?logo=nextdotjs&logoColor=white)](https://nextjs.org/)
[![License: Source-Available](https://img.shields.io/badge/license-Source--Available%20(Study--Only)-red.svg)](LICENSE)

**Docs:** [Overview](docs/overview.md) · [Architecture](docs/architecture.md) ·
[API](docs/API.md) · [Database](docs/database.md) · [Features](docs/features.md) ·
[Invariants](docs/INVARIANTS.md) · [Configuration](docs/configuration.md)

---

## What Planora does

Planora lets people organise personal tasks, share them with friends, collaborate
through a per-task comment timeline ("ветки"), and stay in sync through real-time
notifications. It is built as a clean, observable, secure microservices system in
which every service owns its own database and communicates with its peers only
through typed gRPC contracts and a reliable RabbitMQ event bus — never by reading
another service's tables.

It is a learning-grade reference implementation of patterns that matter in real
distributed systems: database-per-service, the transactional outbox/inbox,
CQRS with MediatR, vertical-slice architecture enforced by architecture tests,
defense-in-depth authentication, and a full CI/CD and supply-chain security
pipeline.

## Architecture

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
             └────────── gRPC (x-service-key) ──────────┴──── RabbitMQ event bus ─┘
```

Each service is a vertical slice — **Domain → Application → Infrastructure → Api** —
and shares cross-cutting concerns (logging, telemetry, error handling, outbox/inbox,
auth, caching) through the `BuildingBlocks` projects.

| Service | Responsibility | Data store | Local port |
|---|---|---|---|
| **API Gateway** (`Planora.ApiGateway`) | Ocelot ingress: JWT validation, rate limiting, CORS, health routing | — | 5132 |
| **Auth API** | Identity, sessions, JWT and refresh tokens, 2FA, friendships, analytics intake | `planora_auth_db` | 5031 |
| **Todo API** | Tasks, sharing, hidden/viewer state, workers; publishes task-lifecycle events | `planora_todo` | 5100 (gRPC 5101) |
| **Category API** | User categories with colour, icon, and ordering | `planora_category` | 5281 (gRPC 5282) |
| **Messaging API** | Direct user-to-user messages | `planora_messaging` | 5058 |
| **Collaboration API** | Task comment timeline ("ветки"): user / genesis / system comments and their notifications | `planora_collaboration` | 5060 |
| **Realtime API** | SignalR notifications with a Redis backplane | Redis only | 5032 |
| **Frontend** | Next.js 15 App Router, Zustand state, Axios API client | — | 3000 |

Infrastructure runs on PostgreSQL (`5433`), Redis (`6379`), and RabbitMQ
(`5672`, management UI `15672`). All ports are bound to `127.0.0.1` in the local
compose file.

## Tech stack

| Layer | Technologies |
|---|---|
| **Backend** | .NET 10 · ASP.NET Core · EF Core · MediatR (CQRS) · FluentValidation · AutoMapper |
| **Data & messaging** | PostgreSQL · Redis · RabbitMQ · gRPC (internal) · transactional Outbox/Inbox |
| **Gateway** | Ocelot |
| **Frontend** | Next.js 15 · React 18 · TypeScript (strict) · Tailwind CSS · Zustand · Axios |
| **Observability** | OpenTelemetry · Serilog (structured, correlation-enriched) |
| **Quality & security** | xUnit · Moq · NetArchTest · Playwright · Vitest · CodeQL · Trivy · gitleaks · CycloneDX SBOM |
| **Delivery** | Docker · Docker Compose · GitHub Actions · Fly.io manifests |

## Engineering principles

Planora holds itself to a set of closed-form
[architectural invariants](docs/INVARIANTS.md), the most important of which are:

- **Database-per-service** — no service reads another's tables; cross-service
  reads go through gRPC or events.
- **Identity owned by Auth only** — every service validates the shared JWT
  locally and honours security-stamp revocation.
- **Reliable messaging** — integration events are published through the
  **Outbox** pattern and consumed **idempotently** through the **Inbox** pattern.
- **Defense in depth** — gateway JWT plus per-service JWT, an `x-service-key`
  header on every gRPC hop, CSRF double-submit, access tokens held in memory
  only, and refresh tokens in httpOnly cookies.

## Getting started

### Prerequisites

- [.NET 10 SDK](https://dotnet.microsoft.com/)
- [Node.js 20+](https://nodejs.org/)
- [Docker & Docker Compose](https://docs.docker.com/)

### 1. Configure secrets

```bash
cp .env.example .env
# then set the required values (see Configuration below)
```

### 2. Start everything with Docker Compose

```bash
docker compose up --build
```

This brings up PostgreSQL, Redis, RabbitMQ, every service, and the gateway.
Databases and schemas are created automatically on first run.

### 3. Run the frontend

```bash
cd frontend
npm install
npm run dev
```

- Frontend → <http://localhost:3000>
- API Gateway → <http://localhost:5132>

### Local development without Docker (Windows)

On Windows, `Start-Planora-Local.ps1` orchestrates a full local stack: it runs a
preflight (auto-resolving a .NET 10 SDK and starting Docker if needed), brings up the
infrastructure containers, builds the solution, then launches every backend service +
the API gateway and the Next.js frontend as host processes — with health gating and a
graceful Ctrl+C shutdown. Each service creates/ensures its own schema on first startup,
so there is no separate migration step, and the Docker data volumes are preserved across
every run (including `-Clean`).

```powershell
.\Start-Planora-Local.ps1                 # fresh restart (rebuilds), data preserved
.\Start-Planora-Local.ps1 -SkipBuild      # fastest restart — reuse existing build output
.\Start-Planora-Local.ps1 -Clean          # full clean rebuild (wipe bin/obj/.next, data preserved)
.\Start-Planora-Local.ps1 -Lan            # also share on your Wi-Fi/LAN (prints a share URL)
.\Start-Planora-Local.ps1 -SkipFrontend   # backend + gateway only
.\Start-Planora-Local.ps1 -Stop           # stop everything this script started
.\Start-Planora-Local.ps1 -Help           # see all options (Get-Help … -Full for the annotated docs)
```

| Flag | Effect |
|---|---|
| _(none)_ | Stop any prior run, rebuild the solution, start the whole stack. |
| `-Clean` | Wipe `bin`/`obj`/`.next`, `dotnet restore`, rebuild infra images `--no-cache`. Data preserved. |
| `-SkipBuild` | Skip `dotnet build`; start from existing output (`--no-build`). |
| `-SkipFrontend` | Start the backend + gateway only. |
| `-NoBrowser` | Do not open the browser when the frontend is ready. |
| `-Lan` | Open the firewall for ports 3000 + 5132 and print the LAN share URL (see below). |
| `-ExitAfterHealthCheck` | Start, verify every `/health`, then shut down (CI / smoke test). |
| `-Stop` | Stop everything this launcher started and free the ports. Infra/volumes untouched. |

Default ports — frontend `3000`, gateway `5132`; services `5030` (+gRPC `5031`), `5281`
(+`5282`), `5100` (+`5101`), `5060`, `5058`, `5032`; infra PostgreSQL `5433`, Redis `6379`,
RabbitMQ `5672` (UI `15672`). Logs land in `.\logs` (a transcript plus a file per service).

#### Sharing on your Wi-Fi/LAN

Run with `-Lan` and the launcher detects your host's physical LAN IPv4 (ignoring any VPN
virtual adapter, so a split-tunnel VPN doesn't interfere), opens the Windows Firewall for the
frontend (`3000`) and gateway (`5132`) ports — inbound, **LocalSubnet only**, one UAC prompt —
and prints a `http://<your-lan-ip>:3000` URL. Anyone on the same Wi-Fi just opens that URL; the
client auto-targets the API gateway on the same host it was opened from, so there's nothing to
configure on their machine. In development the gateway's CORS and the app's CSP already accept
same-LAN (private-IP) origins. If a teammate can't connect while your VPN is on, keep it in
split-tunnel mode with local/LAN access allowed, and make sure both devices are on the same
(non-guest/non-isolated) network.

Prefer to do it by hand? Start infra with
`docker compose up -d postgres redis rabbitmq`, then run each service and the gateway
with `dotnet run --project Services/<Service>/...Api` (each ensures its own schema on
first start) and the UI with `npm run dev` in `frontend`. The standalone migrator
(`dotnet run --project tools/Planora.Migrator -- --all`) can pre-apply every schema up
front if you'd rather not rely on first-start bootstrap.

## Configuration

Copy `.env.example` to `.env` and set at least the following. The compose file
fails fast if any required secret is missing.

| Variable | Purpose |
|---|---|
| `JWT_SECRET` | Shared JWT signing key (**≥ 32 chars**) |
| `GRPC_SERVICE_KEY` | Inter-service gRPC auth key (**≥ 16 chars**) |
| `POSTGRES_PASSWORD` | PostgreSQL password |
| `REDIS_PASSWORD` | Redis password |
| `RABBITMQ_USER` / `RABBITMQ_PASSWORD` | RabbitMQ credentials |

Full reference: [`docs/configuration.md`](docs/configuration.md) and
[`docs/secrets-management.md`](docs/secrets-management.md).

## Testing

```bash
# Backend — unit, integration, and architecture tests
dotnet test Planora.sln

# Frontend — component / lib / store tests
cd frontend && npm run test

# End-to-end — Docker-backed Playwright flows
cd frontend && npm run e2e
```

Continuous integration runs the full matrix on every push and pull request:
the backend build (`-warnaserror`) and tests, the frontend
lint / type-check / test / build pipeline, Playwright e2e, EF migration scripts,
OpenAPI linting, markdown lint, and a security suite (CodeQL, Trivy IaC,
gitleaks, dependency audits, and a signed CycloneDX SBOM).

## Project structure

```text
Planora/
├── Services/                 # One folder per microservice (Domain/Application/Infrastructure/Api)
│   ├── AuthApi/  TodoApi/  CategoryApi/  MessagingApi/  CollaborationApi/  RealtimeApi/
├── BuildingBlocks/           # Shared Domain / Application / Infrastructure
├── GrpcContracts/            # .proto service contracts
├── Planora.ApiGateway/       # Ocelot gateway
├── frontend/                 # Next.js 15 app
├── tools/Planora.Migrator/   # One-shot EF migration + data-backfill runner
├── tests/                    # xUnit unit / architecture / error-handling tests
├── deploy/fly/               # Fly.io deployment manifests
├── Start-Planora-Local.ps1   # Local (non-Docker) stack orchestrator for Windows
├── Start-Planora-Docker.ps1  # Docker-based stack orchestrator
└── docs/                     # Living documentation
```

## Documentation

| Doc | What's inside |
|---|---|
| [`docs/overview.md`](docs/overview.md) | System overview and feature status |
| [`docs/architecture.md`](docs/architecture.md) | Services, boundaries, request and event flow |
| [`docs/codebase-map.md`](docs/codebase-map.md) | Where everything lives |
| [`docs/database.md`](docs/database.md) | Schemas, ownership, migrations |
| [`docs/API.md`](docs/API.md) | Gateway routes and endpoints |
| [`docs/features.md`](docs/features.md) | Feature-by-feature behaviour |
| [`docs/testing.md`](docs/testing.md) | Test strategy and coverage |
| [`docs/observability.md`](docs/observability.md) | Logging, metrics, tracing, alerts |
| [`docs/production.md`](docs/production.md) · [`docs/deployment.md`](docs/deployment.md) | Production and deployment |
| [`docs/INVARIANTS.md`](docs/INVARIANTS.md) | Architectural invariants |

## Contributing

Contributions are welcome — see [`CONTRIBUTING.md`](CONTRIBUTING.md). Please keep
changes consistent with the architectural invariants and update the relevant docs
and `CHANGELOG.md`. Note that, under the license below, contributions are accepted
on the terms set out in Section 2(d) of the [LICENSE](LICENSE).

## License

Planora is **source-available, not open source.** It is published under the
[Planora Source-Available License (Study-Only)](LICENSE).

You may read, run, and study the code on your own machine for personal,
non-commercial learning. You may **not** use, copy, modify, redistribute, deploy,
or incorporate it (in whole or in part) into any product, service, or system —
or use it to train or evaluate any machine-learning model — without prior written
permission from the copyright holder. The full, binding terms are in
[LICENSE](LICENSE).

Copyright © 2026 4Keyy. All rights reserved.
