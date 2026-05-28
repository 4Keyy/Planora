# Audit branch close-out — `claude/planora-enterprise-audit-1Xm7V`

**Anchor:** branched from `ddd81e6` on 2026-05-27.
**Scope:** the master plan at `/root/.claude/plans/staff-melodic-oasis.md`.
**Outcome:** the audit hot-fix wave (Phase 1.5) closes in full; Phase 2 / 3 / 4
land partially with explicit deferrals on items that genuinely need a
design decision or production-like infrastructure.

This document is the single source of truth for what the branch contains,
what it deliberately defers, and how to verify each piece.

---

## 1. What landed (in order of merge)

| Wave | Task IDs | Headline | Verifier |
|---|---|---|---|
| A | H1, H8, H17, H18 | JWT `ClockSkew` unified, EF SQL capture default-off, `CacheService.RemoveByPatternAsync` implemented via Redis SCAN + UNLINK, MD5→SHA256 | `AuthApiConfigurationTests`, `DependencyInjectionContractTests`, runtime trace inspection |
| B | H5, H7, H16, H21, H22, H23, P2-MIG-002 | `flyctl-actions` SHA-pinned, docker-compose `/health/ready`, npm-audit `--audit-level=high`, Trivy fail-on-high, NuGet cache, CD `/health/live` smoke, idempotence marker check | CI green at the higher thresholds |
| C | H9, H10, H11, H13, H14, H15 | Hydration year, rehydrate race, CSRF retry on main client, cross-tab logout via BroadcastChannel, traceparent reuse on 401 retry, CSP `object-src/child-src/worker-src` | Vitest + curl `-I` |
| D | H2, H3, H4, H6, H19 | Refresh-token reuse detection, Todo description max length reconciled, Auth telemetry wrapper removed, migrator schema-drift guard, `CODEOWNERS` | `RefreshToken_WhenReplayed_*`, `MigratorDriftDetection*`, INV-OBS-5 enforcement |
| E | docs | INV-AUTH-6, INV-AUTH-7, INV-FLOW-5, INV-OBS-5 strengthened, INV-FLOW-4 amended | `docs/INVARIANTS.md` diff |
| F | H12, H20 | AbortController on tasks-page fetches, opt-in pre-commit hooks via `.githooks/` | `git config core.hooksPath .githooks` |
| T2.3 | — | `BaseRepository` + `OutboxRepository` consolidated into BuildingBlocks; per-service duplicates marked `[Obsolete]` | `CanonicalOutboxRepositoryTests` |
| G | T2.8 + H12 follow-up | `loading.tsx` + `error.tsx` per major segment; dashboard AbortController | manual verification |
| H | T3.10, T3.11 | Referrer-Policy `strict-origin`; Permissions-Policy 22-rule set; COOP/CORP; gateway `ForwardedHeaders` only when KnownProxies non-empty; gRPC trust-context pin | `ServiceKeyInterceptorTests::ClientInterceptor_DoesNotLeakAuthorizationHeader…` |
| T4.1 | — | EF Core N+1 sentinel interceptor + INV-PERF-1 | `N1SentinelTests` |
| T4.3 | — | `planora.cache.operations{prefix,outcome}` metric | `CacheServiceMetricsTests` |
| I | T3.8, T3.9, T4.4, T4.7 | RabbitMQ publisher confirms + mandatory, per-service pool sizing (`MaxPoolSize=10`), CodeQL per-language build-mode (csharp=autobuild), nightly NuGet vuln auto-PR | CI run + connection-pool inspection |
| J | T4.8, T4.11 | Redis `maxmemory 256mb` + `allkeys-lru`; avatar `next/image` optimizer | `docker compose up` observation; avatar test |
| T3.7 | — | Sigstore keyless SBOM attestation for the frontend bundle | Rekor lookup post-merge to `main` |
| T2.5 | — (scaffold only) | Realtime persistence: `Notification`, `NotificationDelivery`, `RealtimeDbContext`, migrator wiring, conditional DI with NoOp `IDomainEventDispatcher`. **INV-DATA-5 is dormant — behaviour follow-up needs `dotnet ef`.** | DI compile-check; migration file is the deferred half |
| T3.5 | — | Forward-looking security-stamp rotation policy: `SecurityStampUsageContractTests` source-scans every handler that injects `ISecurityStampService` and asserts it calls `SetStampAsync`; INV-AUTH-4 documents shipped + future + opt-out rotation points | `SecurityStampUsageContractTests` |
| T4.10 | — | Global `<MotionConfig reducedMotion="user">` covers all framer-motion (including Toaster); `useAdaptiveIterations` picks WebGL shader iterations from `navigator.hardwareConcurrency` (1 / 2 / 3 for ≤2 / 4-7 / ≥8 cores) | `color-bends.test.tsx` parameterised smoke |
| T4.5 | — | Postgres `idle_in_transaction_session_timeout = 30000` (docker-compose + Fly Postgres doc'd) | `flyctl postgres config show` |
| T2.6 | — | Playwright UI project (Chromium) with 5 specs: login, register, forgot-password, reset-password (end-to-end forgot→reset→login loop with auth-log token scrape), tasks-page, profile-update, verify-email | `npm run e2e -- --project=ui` |
| T4.2 | — (configs only) | Partial composite index `(Status, NextRetryUtc, OccurredOnUtc) WHERE Status IN ('Pending','Failed')` on every outbox table; missing Messaging `OutboxMessageConfiguration` filled in; `TodoItemComment.AuthorId` indexed; INV-COMM-5 codifies the convention | migration files are the deferred half |
| T2.7 | — | ADR-0006 documents the `force-dynamic` + per-request nonce trade-off, lists three sunset conditions, rejects three alternatives with reasons | `docs/DECISIONS/0006-force-dynamic-and-csp-nonce.md` |
| T3.6 | — | IDOR coverage baseline (`docs/security-idor-coverage.md`), INV-AZ-8, explicit cross-user xUnit for `RevokeSessionCommandHandler` closing the only flagged gap | `RevokeSession_WhenTokenBelongsToAnotherUser_ReturnsForbidden` |
| Self-audit | — | Five defects in the branch's own commits fixed: Realtime DI startup crash, SBOM attestation digest mismatch, double WebGL scene build, T3.5 regex too narrow, IDOR doc cited fabricated test names + had a real gap + wrong route paths | this doc |

---

## 2. What was deliberately deferred

These items remain open in the master plan because they require a
direction decision the audit-branch author could not make alone, or
infrastructure that does not yet exist in the dev container.

| Task | What's missing | Why deferred | Unblocker |
|---|---|---|---|
| **T2.1** RFC 7807 + canary | Header-vs-query versioning choice; rollout percentage policy; deletion timeline for the three-shape `parseApiResponse`. | The canary infrastructure (gateway-level header routing) is shipped, but the migration sequencing is a product-owner call. | Decision on canary cadence + which endpoints migrate first. |
| **T2.2-fu** generated TS client + Zod | Depends on T2.1 stable. | Sequenced after T2.1. | T2.1 closure + decision on Zod vs io-ts vs Valibot at the boundary. |
| **T2.4** BuildingBlocks split | Five sub-packages (Observability, Messaging, Web, Security, Persistence). | Large code-movement diff; needs decision on which sub-package to extract first (Observability lowest risk, Persistence highest leverage). | Maintainer's preference on staging. |
| **T2.5 part 2** Realtime persist-before-push | The initial EF migration files + the `NotificationService` rewire that persists before dispatching. | Generating the migration requires `dotnet ef` in the dev environment; the rewire is a behavioural change that needs verification under test. | Run `dotnet ef migrations add InitialRealtimeSchema --project Services/RealtimeApi/Planora.Realtime.Infrastructure --startup-project tools/Planora.Migrator` and ship the migration + the `NotificationService` change together. |
| **T2.6 remaining** | 2FA setup/disable UI, sharing/hidden UI. | Both flows are significantly more complex (2FA needs TOTP-code generation parity; sharing/hidden needs friend graph setup) — better as their own focused PRs. | Per-flow PR. |
| **T3.1** SPIFFE/SPIRE mTLS | Per-service identity on the gRPC backplane. | Major infrastructure work; depends on Fly capacity and ops decisions. | Ops capacity allocation. |
| **T3.4** JWT RS256 + JWKS | Asymmetric signing key with JWKS endpoint. | Multi-service canary with dual-sign window; needs key rotation cadence decision. | Decision on rotation schedule + canary length. |
| **T3.6 auto-gen** | Theory test generator that emits one xUnit per IDOR row from the OpenAPI source-of-truth. | Depends on T2.1 publishing the OpenAPI as the canonical endpoint list. | T2.1 closure. |
| **T4.2 migrations** | The actual EF migration files for the index additions configured in this branch. | Same as T2.5 part 2 — needs `dotnet ef`. INV-FLOW-5 guards against silent partial application. | Run `dotnet ef migrations add T4_2_OutboxActiveIndex` against each affected `*.Infrastructure` project. |
| **T4.6** Outbox extraction | Move `OutboxProcessor` out of the API processes into the existing `deploy/fly/outbox-worker.fly.toml` app, with `pg_advisory_lock` per service-table for single-flight. | Needs a feature-flag rollout sequencing decision (which service first, how long to dual-run). | Decision on canary order. |

---

## 3. Verification

### Backend

- `dotnet build` — all projects compile.
- `dotnet test --filter "Category!=Integration"` — unit tests green, including:
  - `SecurityStampUsageContractTests` (T3.5)
  - `RevokeSession_WhenTokenBelongsToAnotherUser_ReturnsForbidden` (T3.6)
  - `N1SentinelTests` (T4.1)
  - `CacheServiceMetricsTests` (T4.3)
  - `CanonicalOutboxRepositoryTests` (T2.3)
  - `ArchitectureTests` (now includes `Planora.Realtime.Domain`)
  - `AuthLifecycleHandlerTests::RefreshToken_WhenReplayed_…` (H2)
- `dotnet test --filter "TestType=Security"` — every security-trait test green.

### Frontend

- `npm run typecheck` + `npm run lint` — green.
- `npm test` — Vitest suite green.
- `npm run e2e -- --project=api` — existing API contract spec green.
- `npm run e2e -- --project=ui` — 5 new UI specs green when the frontend is
  reachable on `E2E_FRONTEND_URL` (gracefully skip otherwise).

### CI

- `.github/workflows/security.yml` — gitleaks, dotnet-vuln, npm-audit (high),
  CodeQL (per-language build-mode), Trivy IaC (fail-on-high), SBOM generation,
  Sigstore attestation.
- `.github/workflows/migrations.yml` — idempotence marker check.
- `.github/workflows/nuget-vuln-pr.yml` — nightly vulnerable-NuGet auto-PR.
- `.github/workflows/e2e.yml` — docker stack + Chromium + frontend build/start,
  Playwright (api + ui projects).

### Operational

- `docker compose --env-file .env up -d --build` — stack comes healthy on
  `/health/ready` for every service.
- `flyctl postgres config update --idle-in-transaction-session-timeout 30000`
  (per `deploy/fly/README.md` "Postgres tuning" section) — applies T4.5 in
  production.

---

## 4. Invariants added in this branch

| ID | Subject | Pinned by |
|---|---|---|
| INV-COMM-5 | Outbox partial composite index `ix_outbox_messages_active` | Per-service `OutboxMessageConfiguration.cs` |
| INV-AUTH-6 | Refresh-token reuse detection | `RefreshTokenCommandHandler` + `AuthLifecycleHandlerTests::RefreshToken_WhenReplayed_…` |
| INV-AUTH-7 | Single source of truth for JWT `ClockSkew` | `AuthApiConfigurationTests` + `DependencyInjectionContractTests` |
| INV-AZ-6 | gRPC client never propagates HTTP `Authorization` | `ServiceKeyInterceptorTests::ClientInterceptor_DoesNotLeakAuthorizationHeader…` |
| INV-AZ-7 | Gateway `ForwardedHeaders` gated on non-empty `KnownProxies` | gateway integration test |
| INV-AZ-8 | IDOR coverage table contract | `docs/security-idor-coverage.md` + `SecurityStampUsageContractTests` (forward-looking) |
| INV-DATA-5 (deferred) | Realtime notifications are durable — scaffold landed, behaviour deferred | `RealtimeDbContext`, `NotificationConfiguration`, `NotificationDeliveryConfiguration` |
| INV-FLOW-5 | Migrator rejects schema drift | `MigratorDriftDetection*` |
| INV-OBS-5 (strengthened) | No wrappers around `AddPlanoraTelemetry`; EF SQL text capture default-off | reflection test on `Program.cs` |
| INV-PERF-1 | EF N+1 sentinel interceptor + per-request query budget | `N1SentinelTests` |

---

## 5. New ADRs

| ID | Decision |
|---|---|
| ADR-0006 | `force-dynamic` + per-request CSP nonce stay until hash-based CSP wiring or a Next.js minor with a stable hash-manifest API lands. Three alternatives examined and rejected with reasons. |

---

## 6. Files touched (high-level by area)

- **Backend services** — Auth, Category, Messaging, Realtime, Todo
  Infrastructure projects (config + DI + Persistence/Configurations).
- **Building blocks** — `Caching` (SCAN/UNLINK), `Logging` (telemetry
  default), `Messaging` (publisher confirms), `IdempotentConsumer`
  (SHA256), `Persistence` (canonical OutboxRepository, N1Sentinel),
  `Configuration` (SecurityConstants), `Extensions` (JWT clockSkew
  consumer extension), `Observability` (cache metric).
- **Gateway** — ForwardedHeaders gating, clock-skew unification.
- **Frontend** — `layout.tsx` (MotionConfig), `middleware.ts` (CSP),
  `api.ts` + `auth-broadcast.ts` (CSRF retry, cross-tab logout,
  traceparent reuse), `tasks/page.tsx` + `dashboard/page.tsx`
  (AbortController), `avatar.tsx` (next/image), 4 segment
  `loading.tsx`/`error.tsx` pairs, `motion-preferences-provider.tsx`,
  `color-bends-layer.tsx` (adaptive iterations).
- **Tests** — 7+ new xUnit test files; 5 new Playwright UI specs +
  scaffold; Vitest tests for color-bends, api-interceptors, todo-small.
- **CI/CD** — `cd.yml`, `ci.yml`, `e2e.yml`, `migrations.yml`,
  `nuget-vuln-pr.yml` (new), `openapi.yml`, `security.yml` (Sigstore
  attestation).
- **Infra** — `docker-compose.yml` (Redis maxmemory, Postgres
  idle-tx, pool sizing, healthcheck paths), `deploy/fly/.env.fly.example`,
  `deploy/fly/README.md` (Postgres tuning section), `.env.production.example`.
- **Docs** — `INVARIANTS.md` (9 new/strengthened rules), `auth-security.md`,
  `caching.md`, `security-idor-coverage.md` (new), `DECISIONS/0006-*.md`
  (new), this close-out doc, `CHANGELOG.md`.
- **Governance** — `.github/CODEOWNERS`, `.githooks/pre-commit`,
  `scripts/install-hooks.sh`, `CONTRIBUTING.md` (opt-in hooks section).

---

## 7. Known limitations honestly stated

- **T2.5 is scaffold-only.** The runtime behaviour change
  (`NotificationService` persists before pushing) does not ship in this
  branch. INV-DATA-5 carries a `(deferred — scaffold only)` marker.
- **T4.2 ships configurations, not migrations.** `dotnet ef migrations
  add` was not available in the dev container. INV-FLOW-5 ensures the
  drift surfaces loudly when the migration is generated locally and
  applied.
- **T2.6 covers 5 of 7 critical flows.** The 2FA setup/disable and
  sharing/hidden UI specs are tracked as separate work.
- **T3.7 attestation subject** uses the SBOM file's own SHA-256 (via
  `subject-path`) rather than the digest of a built artefact. Tightens
  once a single bundle exists to digest.
- **Architecture test** for `Planora.Realtime.Domain` was added; if the
  new entities ever take on infrastructure references the architecture
  suite catches it.

---

## 8. Recommended next-PR sequencing

1. **T2.5 part 2** — `dotnet ef migrations add InitialRealtimeSchema` +
   `NotificationService` rewire + flip the docker-compose connection
   string from commented to active. Smallest blast radius among the
   deferred items.
2. **T4.2 migrations** — generate migration files for the
   `ix_outbox_messages_active` partial index + the
   `TodoItemComment.AuthorId` index across the four affected services.
3. **T2.6 follow-ups** — sharing/hidden + 2FA UI specs.
4. **T3.4** — JWT RS256 + JWKS canary (high-impact security win;
   contained scope per service).
5. **T2.1** — RFC 7807 unification at the gateway. Unblocks T2.2-fu and
   T3.6 auto-gen.
6. **T2.4** — BuildingBlocks split, one sub-package per PR.
7. **T4.6** — Outbox extraction with feature-flag canary.
8. **T3.1** — SPIFFE/SPIRE mTLS. Lands last in Phase 3 because it
   depends on T3.4 + ops capacity.
