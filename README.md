<div align="center">

# 🪐 Planora

**Organise. Share. Collaborate — in real time.**

**Planora is a personal productivity & task-collaboration platform**, with six
**.NET 10 services** behind an **Ocelot API gateway** and a **Next.js 16** frontend.

The repository implements database-per-service, CQRS, gRPC contracts, event
dispatch, JWT authentication and optional telemetry. The audit records where
the implementation still falls short of its architectural policies.

[![CI](https://github.com/4Keyy/Planora/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/4Keyy/Planora/actions/workflows/ci.yml)
[![Security Scan](https://github.com/4Keyy/Planora/actions/workflows/security.yml/badge.svg?branch=main)](https://github.com/4Keyy/Planora/actions/workflows/security.yml)
[![.NET 10](https://img.shields.io/badge/.NET-10.0-512BD4?logo=dotnet&logoColor=white)](https://dotnet.microsoft.com/)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-000000?logo=nextdotjs&logoColor=white)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![License: Source-Available](https://img.shields.io/badge/license-Source--Available%20(Study--Only)-red.svg)](LICENSE)

**Docs:** [Overview](docs/overview.md) · [Architecture](docs/architecture.md) ·
[API](docs/API.md) · [Database](docs/database.md) · [Features](docs/features.md) ·
[Invariants](docs/INVARIANTS.md) · [Configuration](docs/configuration.md) ·
[Observability](docs/observability.md) · [Operations](docs/OPERATIONS.md)

</div>

---

> **Current verification:** the [2026-10-06 repository audit](docs/audits/2026-10-06.md) records tested source coverage, corrected contracts, deployment/schema blockers and open authorization/reliability findings. Read it before treating clean-install or production-readiness claims as established.

## ✨ Why Planora

Planora combines collaborative task management with a service-based backend
and a keyboard-oriented frontend.

- **Independent services.** Six APIs own separate stores and communicate through
  typed gRPC and RabbitMQ. Architecture tests check selected dependency rules;
  they do not prove every runtime data-access boundary.
- **Authentication controls.** Rotating refresh tokens, in-memory access tokens,
  httpOnly cookies, double-submit CSRF, service JWT validation, service keys,
  PBKDF2 password hashing and optional TOTP with recovery codes. Current access
  and revocation limits are recorded in the [security reference](docs/auth-security.md).
- **Observability support.** Serilog and OpenTelemetry registrations, correlation
  identifiers and custom instruments. Exported data depends on the configured
  collectors and service-specific logging setup.
- **Keyboard and collaboration.** Next.js 16 App Router, shared motion tokens,
  command palette, quick capture, live task branches, SignalR notifications and
  a WebGL ribbon background.
- **Windows development tooling.** A PowerShell launcher provisions local
  prerequisites and coordinates services with health gating and shutdown.
  [Database prerequisites](docs/getting-started.md) still apply; a successful
  prerequisite check does not establish that a fresh stack can boot.
- **Configured quality checks.** Backend unit/architecture/error-handling tests,
  frontend coverage gates, Playwright API/UI suites and security workflows.
  The [dated audit](docs/audits/2026-10-06.md) records actual results and open gaps.

## 🚀 Feature tour

| Area | What you get |
|---|---|
| **Accounts & sessions** | Email/password sign-up with verification, JWT access tokens + rotating refresh tokens, multi-device session lifecycle, and seamless silent session restore. |
| **Two-factor auth** | Opt-in TOTP 2FA with a scannable QR code (works with any authenticator app) and recovery flow. |
| **Profiles** | Editable profile, avatar upload (server-side image processing), and a security center. |
| **Friendships** | Send / accept / decline friend requests; sharing is friends-only by design. |
| **Tasks** | Create, prioritise, schedule, and categorise tasks with colour- and icon-coded categories and custom ordering. |
| **Sharing & privacy** | Named shares and public-to-friends discovery, plus per-viewer hidden/completion preferences and server redaction. Some join/revocation paths do not fully enforce the intended friend boundary; see the [authorization audit](docs/security-idor-coverage.md). |
| **"Take it into work" (In Progress)** | Collaborators can join a shared task as a worker, with worker counts and capacity — or leave at any time. |
| **Branch timeline** | A task timeline with an Author's Note, threaded comments and materialized lifecycle events. Outbox/Inbox gaps can cause missing or duplicated entries; see [Architecture](docs/architecture.md). |
| **Direct messaging** | One-to-one messages between friends. |
| **Real-time notifications** | SignalR push with an optional Redis backplane, and notification REST reads when a Realtime database is configured. Client receipt/reconnect replay is not guaranteed. |
| **The keyboard** | A command palette on `⌘K` / `Ctrl K`, capture on `C` from every screen that has it, `?` for the full map, and `J`/`K`, `G G`, `Shift G`, `Space`, `E`, `1`–`5`, `X` over the task list. Every action that has a key shows it. |
| **Undo instead of confirm** | Deleting a task — on the task list or on the dashboard — drops an undo bar for five seconds instead of asking a question first. |
| **Redaction as a shape** | An owner sees how far a shared task reaches as an arc that narrows with the audience; a viewer sees whose task it is instead. |

Full behaviour, rule by rule, lives in **[`docs/features.md`](docs/features.md)**; the design rules
behind it in **[`docs/design-system.md`](docs/design-system.md)**.

---

## 🏗️ Architecture

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
          auth_db      todo_db     category_db   messaging_db  collaboration_db  realtime_db
             └────────── gRPC (x-service-key) ──────────┴──── RabbitMQ event bus ─┘
```

Each service is a **vertical slice** — `Domain → Application → Infrastructure → Api` — and shares
cross-cutting concerns (logging, telemetry, error handling, outbox/inbox, auth, caching) through
the `BuildingBlocks` projects.

| Service | Responsibility | Data store | Local port |
|---|---|---|---|
| **API Gateway** (`Planora.ApiGateway`) | Ocelot ingress: JWT validation, rate limiting, CORS, health routing | — | `5132` |
| **Auth API** | Identity, sessions, JWT + refresh rotation, 2FA, friendships, analytics intake | `planora_auth_db` | `5030` (gRPC `5031`) |
| **Todo API** | Tasks, sharing, hidden/viewer state, workers; publishes task-lifecycle events | `planora_todo` | `5100` (gRPC `5101`) |
| **Category API** | User categories with colour, icon, and ordering | `planora_category` | `5281` (gRPC `5282`) |
| **Messaging API** | Direct user-to-user messages | `planora_messaging` | `5058` |
| **Collaboration API** | Task comment timeline: user / genesis / system comments + notifications | `planora_collaboration` | `5060` |
| **Realtime API** | SignalR fan-out with a Redis backplane, plus a durable notification read-model so an offline recipient is caught up on reconnect | `planora_realtime` + Redis | `5032` |
| **Frontend** | Next.js 16 App Router, Zustand state, Axios API client | — | `3000` |

Infrastructure runs on **PostgreSQL** (`5433`), **Redis** (`6379`), and **RabbitMQ** (`5672`,
management UI `15672`). In local development all ports bind to `127.0.0.1`.

### Engineering principles

Planora holds itself to a set of closed-form [architectural invariants](docs/INVARIANTS.md),
the most important being:

- **Database-per-service** — no service reads another's tables; cross-service reads go through
  gRPC or events. Enforced by [NetArchTest](https://www.nuget.org/packages/NetArchTest.Rules) tests.
- **Identity owned by Auth only** — every service validates the shared JWT locally and honours
  security-stamp revocation.
- **Event delivery** — a shared Outbox dispatcher combines signaling with polling. Transaction boundaries and Inbox registration vary by service; the [audit](docs/audits/2026-10-06.md) records duplicate-delivery and partial-write gaps. These patterns do not establish an exactly-once guarantee.
- **Defense in depth** — gateway JWT *plus* per-service JWT, an `x-service-key` header on every
  gRPC hop, CSRF double-submit, access tokens held in memory only, refresh tokens in httpOnly cookies.

---

## 🧰 Tech stack & packages

Backend package versions are managed centrally in
[`Directory.Packages.props`](Directory.Packages.props); frontend versions in
[`frontend/package.json`](frontend/package.json).

### Backend — .NET 10

| Purpose | Packages |
|---|---|
| **Runtime / API** | [.NET 10](https://dotnet.microsoft.com/) · [ASP.NET Core](https://learn.microsoft.com/aspnet/core/) · [Swashbuckle.AspNetCore `6.9.0`](https://www.nuget.org/packages/Swashbuckle.AspNetCore) (OpenAPI/Swagger) |
| **API gateway** | [Ocelot `24.1.0`](https://www.nuget.org/packages/Ocelot) · [Ocelot.Provider.Polly `24.1.0`](https://www.nuget.org/packages/Ocelot.Provider.Polly) |
| **CQRS / validation / mapping** | [MediatR `12.5.0`](https://www.nuget.org/packages/MediatR) · [FluentValidation `11.12.0`](https://www.nuget.org/packages/FluentValidation) · [AutoMapper `15.1.3`](https://www.nuget.org/packages/AutoMapper) |
| **Data access** | [EF Core `10.0.8`](https://www.nuget.org/packages/Microsoft.EntityFrameworkCore) · [Npgsql.EntityFrameworkCore.PostgreSQL `10.0.2`](https://www.nuget.org/packages/Npgsql.EntityFrameworkCore.PostgreSQL) |
| **Messaging / events** | [RabbitMQ.Client `7.2.1`](https://www.nuget.org/packages/RabbitMQ.Client) — used directly; the outbox dispatcher and inbox live in `BuildingBlocks`, not in a bus framework |
| **Internal RPC** | [Grpc.AspNetCore `2.80.0`](https://www.nuget.org/packages/Grpc.AspNetCore) · [Google.Protobuf `3.34.1`](https://www.nuget.org/packages/Google.Protobuf) |
| **Caching / rate-limiting** | [StackExchange.Redis `2.12.14`](https://www.nuget.org/packages/StackExchange.Redis) · [Microsoft.Extensions.Caching.StackExchangeRedis `10.0.8`](https://www.nuget.org/packages/Microsoft.Extensions.Caching.StackExchangeRedis) · [RedisRateLimiting.AspNetCore `1.2.1`](https://www.nuget.org/packages/RedisRateLimiting.AspNetCore) |
| **Resilience** | [Polly `8.6.6`](https://www.nuget.org/packages/Polly) · [Microsoft.Extensions.Http.Resilience `10.5.0`](https://www.nuget.org/packages/Microsoft.Extensions.Http.Resilience) |
| **Auth / crypto** | [Microsoft.AspNetCore.Authentication.JwtBearer `10.0.8`](https://www.nuget.org/packages/Microsoft.AspNetCore.Authentication.JwtBearer) · [System.IdentityModel.Tokens.Jwt `8.18.0`](https://www.nuget.org/packages/System.IdentityModel.Tokens.Jwt) · PBKDF2 via `System.Security.Cryptography.Rfc2898DeriveBytes` (BCL) · [Otp.NET `1.4.1`](https://www.nuget.org/packages/Otp.NET) · [QRCoder `1.8.0`](https://www.nuget.org/packages/QRCoder) · [DataProtection `10.0.8`](https://www.nuget.org/packages/Microsoft.AspNetCore.DataProtection) |
| **Real-time** | [SignalR.StackExchangeRedis `10.0.8`](https://www.nuget.org/packages/Microsoft.AspNetCore.SignalR.StackExchangeRedis) |
| **Images** | [SixLabors.ImageSharp `3.1.11`](https://www.nuget.org/packages/SixLabors.ImageSharp) |
| **Observability** | [OpenTelemetry `1.15.3`](https://www.nuget.org/packages/OpenTelemetry) (+ ASP.NET Core / HTTP / EF Core / Runtime instrumentation & OTLP exporter) · [Serilog `4.3.1`](https://www.nuget.org/packages/Serilog) (+ [Console](https://www.nuget.org/packages/Serilog.Sinks.Console), [File](https://www.nuget.org/packages/Serilog.Sinks.File), [Seq](https://www.nuget.org/packages/Serilog.Sinks.Seq), [Grafana Loki](https://www.nuget.org/packages/Serilog.Sinks.Grafana.Loki) sinks) |
| **Health checks** | [AspNetCore.HealthChecks](https://www.nuget.org/packages?q=AspNetCore.HealthChecks) for [NpgSql](https://www.nuget.org/packages/AspNetCore.HealthChecks.NpgSql) · [Redis](https://www.nuget.org/packages/AspNetCore.HealthChecks.Redis) · [RabbitMQ](https://www.nuget.org/packages/AspNetCore.HealthChecks.RabbitMQ) `9.0.0` |
| **Testing** | [xUnit `2.9.3`](https://www.nuget.org/packages/xunit) · [Moq `4.20.72`](https://www.nuget.org/packages/Moq) · [FluentAssertions `6.12.2`](https://www.nuget.org/packages/FluentAssertions) · [NetArchTest.Rules `1.3.2`](https://www.nuget.org/packages/NetArchTest.Rules) · [Mvc.Testing `10.0.8`](https://www.nuget.org/packages/Microsoft.AspNetCore.Mvc.Testing) · [coverlet `6.0.4`](https://www.nuget.org/packages/coverlet.collector) |

### Frontend — Next.js 16

| Purpose | Packages |
|---|---|
| **Framework** | [next `16.2`](https://www.npmjs.com/package/next) · [react `18.3`](https://www.npmjs.com/package/react) · [react-dom `18.3`](https://www.npmjs.com/package/react-dom) · [typescript `5.7`](https://www.npmjs.com/package/typescript) |
| **State / data** | [zustand `5`](https://www.npmjs.com/package/zustand) · [axios `1.18`](https://www.npmjs.com/package/axios) |
| **Forms / validation** | [react-hook-form `7.80`](https://www.npmjs.com/package/react-hook-form) · [zod `3.24`](https://www.npmjs.com/package/zod) · [@hookform/resolvers `3.9`](https://www.npmjs.com/package/@hookform/resolvers) |
| **UI / styling** | [tailwindcss `3.4`](https://www.npmjs.com/package/tailwindcss) · Radix primitives — [dropdown-menu](https://www.npmjs.com/package/@radix-ui/react-dropdown-menu), [popover](https://www.npmjs.com/package/@radix-ui/react-popover), [slot](https://www.npmjs.com/package/@radix-ui/react-slot) · [lucide-react](https://www.npmjs.com/package/lucide-react) · [class-variance-authority](https://www.npmjs.com/package/class-variance-authority) · [tailwind-merge](https://www.npmjs.com/package/tailwind-merge) · [clsx](https://www.npmjs.com/package/clsx) · [Plus Jakarta Sans](https://www.npmjs.com/package/@fontsource/plus-jakarta-sans) |
| **Motion** | [framer-motion `11`](https://www.npmjs.com/package/framer-motion). The ribbon background is raw WebGL 1 — one fragment shader over one quad — and pulls in no 3D library. |
| **Realtime** | [@microsoft/signalr `10`](https://www.npmjs.com/package/@microsoft/signalr) |
| **Testing** | [vitest `4`](https://www.npmjs.com/package/vitest) · [@testing-library/react `16`](https://www.npmjs.com/package/@testing-library/react) · [@playwright/test `1.61`](https://www.npmjs.com/package/@playwright/test) |

### Infrastructure & delivery

[PostgreSQL](https://www.postgresql.org/) · [Redis](https://redis.io/) ·
[RabbitMQ](https://www.rabbitmq.com/) · [Docker](https://www.docker.com/) &
[Docker Compose](https://docs.docker.com/compose/) · [GitHub Actions](https://github.com/features/actions) ·
[Fly.io](https://fly.io/) manifests · [CodeQL](https://codeql.github.com/) ·
[Trivy](https://trivy.dev/) · [gitleaks](https://github.com/gitleaks/gitleaks) ·
[CycloneDX SBOM](https://cyclonedx.org/).

---

## ⚡ Getting started

### Prerequisites

- [.NET 10 SDK](https://dotnet.microsoft.com/) (the Windows launcher auto-installs a local copy if missing)
- [Node.js 20.9+](https://nodejs.org/) & npm
- [Docker & Docker Compose](https://docs.docker.com/)

### 1. Configure secrets

```bash
cp .env.example .env          # Linux/macOS/WSL
# Copy-Item .env.example .env # PowerShell
```

Then fill in the required values (see [Configuration](docs/configuration.md)). To generate
strong secrets:

```bash
openssl rand -base64 48   # JWT_SECRET
openssl rand -base64 32   # GRPC_SERVICE_KEY
openssl rand -base64 24   # POSTGRES_PASSWORD / REDIS_PASSWORD
```

Without OpenSSL on the path, PowerShell generates the same lengths:

```powershell
$b = New-Object byte[] 48
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
try { $rng.GetBytes($b) } finally { $rng.Dispose() }
[Convert]::ToBase64String($b)          # 48 bytes → JWT_SECRET; use 32 / 24 for the others
```

### 2. Start everything with Docker Compose

```bash
docker compose up --build
```

This brings up PostgreSQL, Redis, RabbitMQ, every service, and the gateway. Five services invoke schema initialization, but the tracked Todo migration chain lacks its initial baseline and Realtime needs a separate migration. Resolve the [fresh-install caveat](docs/deployment.md#schema-initialization-and-migration-runner) before expecting a clean database to boot.

### 3. Run the frontend

```bash
cd frontend
npm install
npm run dev
```

- Frontend → <http://localhost:3000>
- API Gateway → <http://localhost:5132>
- RabbitMQ management → <http://localhost:15672>

### 🪟 One-command local stack (Windows)

On Windows, **`Start-Planora-Local.ps1`** orchestrates the whole stack for fast iteration: it runs a
preflight (auto-resolving a .NET 10 SDK and starting Docker if needed), brings up the infrastructure
containers, builds the solution, then launches every backend service + the gateway and the Next.js
frontend as host processes — with health gating and a graceful Ctrl+C shutdown. Auth/Category/Todo/Collaboration/Messaging invoke schema initialization; Realtime needs its explicit migration and Todo needs a complete baseline, and the Docker data volumes are preserved
across every run, including `-Clean`.

```powershell
.\Start-Planora-Local.ps1                 # fresh restart (rebuilds), data preserved
.\Start-Planora-Local.ps1 -SkipBuild      # fastest restart — reuse existing build output
.\Start-Planora-Local.ps1 -Clean          # full clean rebuild (wipe bin/obj/.next, data preserved)
.\Start-Planora-Local.ps1 -Lan            # also share on your Wi-Fi/LAN (prints a share URL)
.\Start-Planora-Local.ps1 -Prod           # LAN share, but Release builds + a real `next build`
.\Start-Planora-Local.ps1 -SkipFrontend   # backend + gateway only
.\Start-Planora-Local.ps1 -Stop           # stop everything this script started
.\Start-Planora-Local.ps1 -Help           # all options (Get-Help … -Full for annotated docs)
```

| Flag | Effect |
|---|---|
| *(none)* | Stop any prior run, rebuild the solution, start the whole stack. |
| `-Clean` | Wipe `bin`/`obj`/`.next`, `dotnet restore`, rebuild infra images `--no-cache`. Data preserved. |
| `-SkipBuild` | Skip `dotnet build`; start from existing output (`--no-build`). |
| `-SkipFrontend` | Start the backend + gateway only. |
| `-NoBrowser` | Do not open the browser when the frontend is ready. |
| `-Lan` | Open **and verify** the firewall for `3000` + `5132`, actively self-test reachability, and print a **READY** verdict (see below). |
| `-Prod` | Everything `-Lan` does, in a production configuration: Release backend builds, `ASPNETCORE_ENVIRONMENT=Production`, the Redis-backed distributed rate limiter, and `next build` + `next start` instead of the dev server. A local run terminates no TLS, so it serves plain HTTP and sets `Security__RequireHttps=false` to keep the auth cookies usable. |
| `-ExitAfterHealthCheck` | Start, verify every `/health`, then shut down (CI / smoke test). |
| `-Stop` | Stop everything this launcher started and free the ports. Infra/volumes untouched. |

`Start-Planora-Docker.ps1` takes `-Clean`, `-SkipFrontend`, `-NoBrowser`, `-ExitAfterHealthCheck`,
`-Stop`, and `-Help`; `-SkipBuild`, `-Lan`, and `-Prod` belong to the local launcher only.

Logs land in `.\logs` (a transcript plus a file per service); each start of either launcher removes
the ones older than 14 days. The companion
**`Start-Planora-Docker.ps1`** runs the entire stack (services included) inside Docker.

#### 📡 Sharing on your Wi-Fi/LAN

Run with `-Lan` and the launcher detects your host's physical LAN IPv4 (ignoring any VPN virtual
adapter, so a split-tunnel VPN doesn't interfere), opens the Windows Firewall for ports `3000` and
`5132` (inbound, **LocalSubnet only**, one UAC prompt — **approve it**), **verifies the rule was
created**, and prints a `http://<your-lan-ip>:3000` URL. Anyone on the same Wi-Fi just opens that URL —
the client auto-targets the gateway on the same host it was opened from, and in development the gateway
CORS and the app CSP already accept same-LAN origins, so there's nothing to configure on their device.
After startup the launcher actively self-tests that both ports are bound **and** that the LAN IP answers
a real TCP connection, then prints one verdict: **READY** (open the URL on the other device), or the
single thing to fix — a closed firewall (it prints the exact elevated command) or a strict-route VPN/TUN
on the host intercepting the LAN (it names the adapter; turn on the VPN's **Allow LAN / Bypass LAN**, or
stop it while sharing). That VPN toggle is the one thing no host-side script can do for you.

---

## ⚙️ Configuration

Copy `.env.example` to `.env` and set the values below. Docker Compose **fails fast** if any
required secret is missing. The full annotated reference lives in
[`.env.example`](.env.example), [`docs/configuration.md`](docs/configuration.md), and
[`docs/secrets-management.md`](docs/secrets-management.md).

### Required

| Variable | Purpose |
|---|---|
| `JWT_SECRET` | Shared HMAC-SHA256 JWT signing key (**≥ 32 chars**). Every service must share the same value. |
| `GRPC_SERVICE_KEY` | Internal service-to-service gRPC auth key (**≥ 16 chars**), validated on every hop. |
| `POSTGRES_PASSWORD` | PostgreSQL password (bound to `127.0.0.1:5433`). `POSTGRES_USER` has a default of `postgres` in `.env.example` and is the only credential Compose does not demand. |
| `REDIS_PASSWORD` | Redis password (`requirepass` is enforced; bound to `127.0.0.1:6379`). |
| `RABBITMQ_USER` / `RABBITMQ_PASSWORD` | RabbitMQ credentials (management UI on `127.0.0.1:15672`). |

### Common optional settings

| Variable | Default | Purpose |
|---|---|---|
| `JwtSettings__AccessTokenExpirationMinutes` | Auth configuration | Direct ASP.NET override; the similarly named `JWT_ACCESS_TOKEN_EXPIRATION_MINUTES` template variable is not injected by Compose. |
| `JwtSettings__RefreshTokenExpirationDays` | `7` | Direct Auth override; `JWT_REFRESH_TOKEN_EXPIRATION_DAYS` is informational in current Compose. |
| `ASPNETCORE_ENVIRONMENT` | launcher / container | Local launcher selects Development (or Production with `-Prod`); Compose sets Docker. |
| `NEXT_PUBLIC_API_URL` | `http://localhost:5132` | Gateway origin the browser calls (auto-derived per host in dev). |
| `Frontend__BaseUrl` | `http://localhost:3000` | Origin used inside verification / password-reset emails. |
| `Email__Provider` | `Log` | `Log` (prints links to logs) · `GmailSmtp` · `Smtp`. |
| `Email__Username` / `Email__Password` | — | Gmail App Password when `Email__Provider=GmailSmtp`. |
| `Cors__AllowedOrigins__N` | localhost | Extra credentialed CORS origins (numbered keys). |

---

## 🧪 Testing & quality gates

```bash
# Backend — unit, integration, and architecture tests
dotnet test Planora.sln

# Frontend — component / lib / store tests (Vitest)
cd frontend && npm run test

# End-to-end — Docker-backed Playwright flows
cd frontend && npm run e2e
```

CI is split across workflows. The main CI still builds/tests backend and frontend on eligible docs-only pushes; the Docker-backed E2E workflow uses path filters:

| Workflow | Runs on | What it does |
|---|---|---|
| [`ci.yml`](.github/workflows/ci.yml) | configured push branches and PRs to main/develop | markdown lint + offline link check, the backend build (`-warnaserror`) and tests, the frontend lint / type-check / test / build pipeline, coverage artefacts |
| [`security.yml`](.github/workflows/security.yml) | push, pull request, and weekly | **gitleaks**, **CodeQL**, **Trivy** IaC scanning, `dotnet list package --vulnerable`, `npm audit`, and CycloneDX SBOM artifacts; the frontend SBOM is attested on push |
| [`e2e.yml`](.github/workflows/e2e.yml) | pull requests touching services, gateway, frontend, or compose | Playwright API and UI flows against the Docker stack plus disposable SMTP sink; see [isolated setup](frontend/e2e/README.md). CI publishes redacted output and failure PNGs only |
| [`openapi.yml`](.github/workflows/openapi.yml) | pull requests touching services or contracts | Swagger/Spectral artifacts for a five-service matrix; Collaboration is currently omitted |
| [`migrations.yml`](.github/workflows/migrations.yml) | pull requests touching `Services/**/Migrations/**` | SQL artifacts for all six services, including Realtime |
| [`perf-smoke.yml`](.github/workflows/perf-smoke.yml) | manual dispatch only | k6 absolute-threshold scenarios against Docker |
| [`cd.yml`](.github/workflows/cd.yml) | `v*` tags or manual ref | Fly blue/green deployment path with unresolved rollout blockers |

---

## 🗂️ Project structure

```text
Planora/
├── Services/                 # One folder per microservice (Domain/Application/Infrastructure/Api)
│   ├── AuthApi/  TodoApi/  CategoryApi/  MessagingApi/  CollaborationApi/  RealtimeApi/
├── BuildingBlocks/           # Shared Domain / Application / Infrastructure
├── GrpcContracts/            # .proto service contracts
├── Planora.ApiGateway/       # Ocelot gateway
├── frontend/                 # Next.js 16 app
├── tools/Planora.Migrator/   # One-shot EF migration + data-backfill runner
├── tests/                    # xUnit unit / architecture / error-handling tests
├── perf/                     # k6 load-test scenarios
├── deploy/fly/               # Fly.io deployment manifests
├── scripts/                  # PowerShell modules the launchers import (PID, ports, health)
├── Start-Planora-Local.ps1   # Local (host-process) stack orchestrator for Windows
├── Start-Planora-Docker.ps1  # Docker-based stack orchestrator
└── docs/                     # Living documentation
```

---

## 📚 Documentation

| Doc | What's inside |
|---|---|
| [`docs/overview.md`](docs/overview.md) | Product, domain model, scenarios, boundaries |
| [`docs/architecture.md`](docs/architecture.md) | Services, boundaries, request and event flow |
| [`docs/codebase-map.md`](docs/codebase-map.md) | Where everything lives |
| [`docs/database.md`](docs/database.md) | Schemas, ownership, migrations |
| [`docs/API.md`](docs/API.md) | Gateway routes and endpoints |
| [`docs/features.md`](docs/features.md) | Feature-by-feature behaviour |
| [`docs/frontend.md`](docs/frontend.md) | Rendering model, data access, state, realtime, every key binding |
| [`docs/design-system.md`](docs/design-system.md) | Tokens with measured contrast, the enforced rules, primitives, motion |
| [`docs/configuration.md`](docs/configuration.md) | Every environment variable, explained |
| [`docs/auth-security.md`](docs/auth-security.md) | Auth flow, CSRF, token rotation, 2FA |
| [`docs/testing.md`](docs/testing.md) | Test strategy and coverage |
| [`docs/observability.md`](docs/observability.md) | Logging, metrics, tracing, alerts |
| [`docs/OPERATIONS.md`](docs/OPERATIONS.md) · [`docs/deployment.md`](docs/deployment.md) | Operations and deployment |
| [`docs/INVARIANTS.md`](docs/INVARIANTS.md) | Architectural invariants |

---

## 🤝 Contributing

Contributions are welcome — see [`CONTRIBUTING.md`](CONTRIBUTING.md). Please keep changes consistent
with the [declared architectural rules and implementation status](docs/INVARIANTS.md) and update the relevant docs and
[`CHANGELOG.md`](CHANGELOG.md). Under the license below, contributions are accepted on the terms set
out in Section 2(d) of the [LICENSE](LICENSE).

---

## 📄 License

Planora is **source-available, not open source.** It is published under the
[Planora Source-Available License (Study-Only)](LICENSE).

You may read, run, and study the code on your own machine for personal, non-commercial learning. You
may **not** use, copy, modify, redistribute, deploy, or incorporate it (in whole or in part) into any
product, service, or system — or use it to train or evaluate any machine-learning model — without
prior written permission from the copyright holder. The full, binding terms are in [LICENSE](LICENSE).

<div align="center">

**Copyright © 2026 4Keyy. All rights reserved.**

*Built with care — engineered like production, designed like a product.*

</div>
