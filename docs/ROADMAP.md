# Roadmap And Open Questions

This file separates **confirmed gaps** (closed-form, observable in code or
configuration) from **recommendations** (work that is sensible but not
required by an existing contract). It is not a promise of future work.

Each section reflects the post-2026-05-26 state. The off-repo engineering
master plan is the authoritative sequencing document; this file mirrors its
Phase-0 / Phase-1 outcomes back into the repository and surfaces the
remaining gaps for Phase 2+.

## Phase Status

| Phase | Theme | Status |
|---|---|---|
| Phase 0 | Engineering guardrails (editorconfig, gitleaks rules, INVARIANTS.md, SBOM, health-probe split, perf baseline, license relicense) | **Closed**. See `CHANGELOG.md` "Phase 0 / Phase 1 engineering audit follow-through". |
| Phase 1 | Observability + deployment foundation (centralized OpenTelemetry, custom metrics, Fly.io manifests, Migrator CLI, CD workflow, Loki Serilog sink, frontend traceparent, per-user rate-limit partition, bootstrap automation) | **Closed code-side**. Activation requires three external accounts (Grafana Cloud, Fly.io, Postgres provider) that the maintainer registers when ready. The codebase is no-op-safe without them. |
| Phase 2 | Architecture normalization (API response unification, OpenAPI-driven TS client, BaseRepository / OutboxRepository consolidation, BuildingBlocks split, Realtime persistence) | **Open**. Risk-sensitive — start with `T2.6 CSRF coverage` (already resolved in ADR-0005) and `T2.2 OpenAPI artifact in CI` as the lowest-risk entry points. |
| Phase 3 | Security hardening (per-service identity / mTLS, JWT RS256 + JWKS, security stamp expansion, IDOR systematic audit) | **Partially open**. T3.7 (per-user rate-limit partition) is done. The rest remain. |
| Phase 4 | Performance & scalability (outbox worker extraction, N+1 sentinel, DB index audit, caching metric, frontend force-dynamic removal) | **Open**. |

## Confirmed Gaps (Phase 2+)

| Area | Gap | Evidence |
|---|---|---|
| API response shape | Frontend handles three distinct shapes (`{value}`, `{data, success, meta}`, raw) through `parseApiResponse`. | `frontend/src/lib/api.ts:43-63`, `docs/architecture.md:191-200` |
<!-- OpenAPI artifact gap: CLOSED 2026-05-26 by .github/workflows/openapi.yml — every PR that touches BuildingBlocks/Services/GrpcContracts attaches a per-service openapi.json. -->
| BuildingBlocks god-module | `Planora.BuildingBlocks.Infrastructure` accumulates Logging + Caching + Messaging + Middleware + Outbox + Inbox + Grpc + Resilience in one assembly. | `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/*` |
| `BaseRepository` / `OutboxRepository` duplicated | Implementations exist in three service Infrastructure projects with near-identical code. | Auth / Category / Messaging Infrastructure folders |
| Realtime persistence | The Realtime service has no DbContext; notification state is in-memory. | absence in `Services/RealtimeApi/Planora.Realtime.Infrastructure` |
| Frontend `force-dynamic` global | `frontend/src/app/layout.tsx` exports `dynamic = "force-dynamic"` to make per-request CSP nonce work, sacrificing static optimization on every route. | `frontend/src/app/layout.tsx`, `frontend/src/middleware.ts` |
| gRPC trust model | Symmetric shared `GRPC_SERVICE_KEY` for the entire backplane; no per-service identity, no mTLS. | `BuildingBlocks/.../Grpc/ServiceKeyServerInterceptor.cs` |
| JWT signing key model | Symmetric HS256 secret shared across services; no JWKS endpoint; no rolling-key window. | `BuildingBlocks/.../Extensions/JwtAuthenticationExtensions.cs` |
| Todo description length | Validator allows 5000, EF config stores 2000. | Todo validators vs. `TodoItemConfiguration.cs` |
| Outbox processor co-located with API | `OutboxProcessor` runs as a `BackgroundService` inside every API process. | `BuildingBlocks/.../Outbox/OutboxProcessor.cs` |
| Frontend container target | Frontend is absent from `docker-compose.yml`; production deployment target for Next.js is not yet declared. | `docker-compose.yml`, `deploy/fly/` |
| Browser-rendered E2E | Playwright covers the gateway API flow, not browser-rendered UI navigation. | `frontend/e2e/auth-todos-sharing-hidden.api.spec.ts` |
| CORS env ergonomics | `.env.example` has comma-style `CORS_ALLOWED_ORIGINS` while services read configuration arrays. | appsettings / service startup |
| Security contact configuration | `SECURITY.md` names GitHub Private Vulnerability Reporting, but enabling it is a repository-settings action. | `SECURITY.md` |

## Recommended Next Work (in master-plan order)

| Priority | Recommendation | Why |
|---|---|---|
| **DONE** | **T2.2 — OpenAPI artifact in CI** (`.github/workflows/openapi.yml`). `dotnet swagger tofile` per service, Postgres + Redis + RabbitMQ provided as GitHub Actions services, JSON validated with `jq` before upload. Foundation for the generated TS client. Spectral linting + a public Stoplight-style viewer remain as follow-ups. | |
| P1 | **T2.3 — Consolidate `BaseRepository` and `OutboxRepository`** into `BuildingBlocks.Infrastructure.Persistence.BaseRepository<TEntity, TDbContext>`. Delete the per-service duplicates behind an `[Obsolete]` adapter for one release. | Three drift surfaces collapse to one. Behaviour-pinning mutation tests run on the shared implementation. |
| P1 | **T2.1 — API response unification** (RFC 7807 ProblemDetails for errors + flat DTOs for success). Migrate behind an `X-Api-Version: 2` header with 5% / 50% / 100% canary. | Closes the longest-living source of silent frontend regressions; unblocks the generated TS client. |
| P2 | **T2.4 — BuildingBlocks split** into `Observability`, `Messaging`, `Web`, `Security`, `Persistence` sub-packages. | Forces explicit dependency declarations; the cohesion score on the dependency graph rises immediately. |
| P2 | **T2.5 — Realtime persistence** + outbox-on-Realtime pattern so notifications survive a pod restart. | Closes the only Phase-2 product-visible gap. |
| P2 | **T3.5 — Security stamp expansion** to trigger on role change, 2FA enable/disable, email change confirmed, admin force-logout. | Today the stamp invalidates only on password change. |
| P2 | **T3.6 — IDOR systematic audit** via auto-generated theory tests for every `[Authorize]` endpoint. | Pins the "user A cannot read user B's resource" property under churn. |
| P3 | **T3.4 — JWT RS256 + JWKS** with a two-key rotation window. | Removes the symmetric-secret-shared-by-every-service footgun. |
| P3 | **T3.1 — Per-service identity** (Vault short-lived secrets → SPIFFE/SPIRE mTLS). | Closes the gRPC backplane single-shared-key blast radius (CSP-3). |
| P3 | **T4.6 — Outbox processor extraction** into a separate worker app with `pg_advisory_lock` so two processors can never compete. | API throughput stops being coupled to outbox latency; the deployable matches `deploy/fly/outbox-worker.fly.toml`. |
| P3 | **T4.4 — Remove `force-dynamic` global**. Per-route CSP nonce instead of every-route. | Restores Next.js static optimization on routes that do not need a CSP nonce. |
| P4 | **T4.1 — N+1 sentinel** EF interceptor failing integration tests on a hot-path N+1. | The cheapest regression class — a CI assertion is enough. |
| P4 | **T4.2 — DB index audit** based on staging `pg_stat_user_indexes`. | Foreign-key columns and soft-delete partial indexes are the usual misses. |
| P4 | **T4.3 — Cache hit-ratio metric** (`planora.cache.hit_ratio` per key prefix). | Closes the open question in [`caching.md`](caching.md) "Observability". |

## Phase-1 follow-ups awaiting external accounts (no code work)

| Item | What activates it |
|---|---|
| OTLP traces and metrics exported to Grafana Cloud | `flyctl secrets set OTEL_EXPORTER_OTLP_ENDPOINT=... --app planora-<name>` on every app, then `flyctl machine restart` |
| Centralized logs in Grafana Cloud Loki | `flyctl secrets set LOKI_URL=... LOKI_USER=... LOKI_TOKEN=... --app planora-<name>` on every app, then restart |
| First production deploy via `.github/workflows/cd.yml` | `flyctl auth token \| gh secret set FLY_API_TOKEN`, then `git tag v0.0.1 && git push --tags` |
| Postgres provider | Choose Neon (recommended) or Fly Postgres; populate `ConnectionStrings__*Database` in `deploy/fly/.env.fly` per [`deploy/fly/README.md`](../deploy/fly/README.md) |

The `scripts/Verify-Phase1-Prereqs.ps1` checker is the single source of
truth for whether the activation conditions above are satisfied.

## Already Documented Architecture Decisions

- [`DECISIONS/0001-microservices.md`](DECISIONS/0001-microservices.md)
- [`DECISIONS/0002-http-only-refresh-cookies.md`](DECISIONS/0002-http-only-refresh-cookies.md)
- [`DECISIONS/0003-csrf-double-submit.md`](DECISIONS/0003-csrf-double-submit.md)
- [`DECISIONS/0004-viewer-specific-todo-visibility.md`](DECISIONS/0004-viewer-specific-todo-visibility.md)
- [`DECISIONS/0005-csrf-coverage-bounded-to-auth-api.md`](DECISIONS/0005-csrf-coverage-bounded-to-auth-api.md)
