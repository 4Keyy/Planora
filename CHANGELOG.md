# Changelog

All notable changes to Planora are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Audit follow-up — correctness, config, and hygiene (2026-05-22)

- **Medium — soft-delete leak on `GetByIdAsync` (BuildingBlocks)**: the shared `BaseRepository.GetByIdAsync` queried by id only, while every sibling method filtered `!IsDeleted`; `TodoDbContext` has no global query filter, so a soft-deleted entity surfaced by id. Added the `!IsDeleted` predicate (`BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Persistence/BaseRepository.cs`).
- **Medium — soft-delete filter bypass on Auth `GetByIdAsync`**: AuthApi's own `BaseRepository.GetByIdAsync` used `FindAsync`, which bypasses EF Core global query filters entirely — a soft-deleted `User`/`Friendship` could be returned despite the configured `HasQueryFilter`. Switched to `FirstOrDefaultAsync` so the filter applies (`Services/AuthApi/Planora.Auth.Infrastructure/Persistence/Repositories/BaseRepository.cs`).
- **Medium — soft-deleted categories leaked through reads**: `CategoryDbContext` had no soft-delete query filter, so `GetByIdAsync`, `FindAsync`, `ExistsAsync`, `CountAsync` and `GetPagedAsync` returned/counted deleted categories. Added a global `HasQueryFilter` on `Category` (`Services/CategoryApi/Planora.Category.Infrastructure/Persistence/Configurations/CategoryConfiguration.cs`).
- **Medium — friendship-revocation share cleanup untestable and non-atomic**: `TodoRepository.RemoveSharesBetweenUsersAsync` issued two separate `ExecuteDeleteAsync` calls; `ExecuteDeleteAsync` is unsupported by the EF Core InMemory test provider, so the path was unverified, and a partial failure could leave shares removed in only one direction. Rewritten to load both directions in one query and remove them under a single `SaveChangesAsync` (`Services/TodoApi/Planora.Todo.Infrastructure/Persistence/Repositories/TodoRepository.cs`).
- **Low — no optimistic concurrency control**: `TodoItem`, `Category` and `Friendship` are mutable aggregates with no concurrency token, so concurrent updates were silently last-write-wins (the in-memory `if (Status != Pending)` guard on `Friendship` does not protect across transactions). Each now uses PostgreSQL's `xmin` system column as a concurrency token (configured as a shadow property, guarded by `Database.IsNpgsql()` so the InMemory test provider is unaffected — no schema column or migration required). The global exception handler already maps the resulting `DbUpdateConcurrencyException` to HTTP 409 (`Services/*/Infrastructure/Persistence/*DbContext.cs`).
- **Low — dead code removed**: `EventBus.cs`/`EventBusOptions.cs` (a `dynamic`-typed compatibility shim with ~14 empty `catch` blocks, never registered — `IEventBus` is always `RabbitMqEventBus`); `TodoHub.cs` (a SignalR hub that was never mapped and exposed client-callable `Notify*` methods taking an arbitrary `userId`); a `Realtime.Domain` → `BuildingBlocks.Infrastructure` project reference (a DDD layering inversion on a project with no source files); and a redundant second `AddGrpc()` in AuthApi `Program.cs`.
- **Low — config gaps**: `docker-compose.yml` now passes `GrpcSettings__ServiceKey` to `api-gateway`; the stale Category gRPC address `:5282` in TodoApi `appsettings.Docker.json` corrected to `:81`; `e2e.yml` actions pinned to commit SHAs; Dependabot gained the `docker` ecosystem; the unused `INCLUDE_ERROR_DETAIL` variable removed from the env templates and docs.
- **Tests**: four `RabbitMqStartupHostedService` tests were rewritten to await the first connection probe deterministically instead of assuming `BackgroundService.ExecuteAsync` runs synchronously inside `StartAsync`. New regression tests cover `GetByIdAsync` soft-delete behavior for the BuildingBlocks, Auth and Category repositories and the two-directional `RemoveSharesBetweenUsersAsync` cleanup. Backend: 701 tests pass; build is warning-clean under `-warnaserror`.

### Security tooling — CI scanning (2026-05-22)

- **CodeQL SAST**: `security.yml` now runs GitHub CodeQL static analysis for `csharp` and `javascript-typescript` with the `security-extended` query suite and buildless analysis (`build-mode: none`). Results are published as SARIF to the repository Security tab.
- **Trivy IaC scan**: a Trivy misconfiguration scan covering Dockerfiles and `docker-compose.yml` was added, with SARIF upload. Introduced in report mode (findings are surfaced, the job does not hard-fail) so the team can ratchet to enforcement once the baseline is clean.
- All workflow action references are pinned to commit SHAs, validated with `actionlint`.

### Distributed rate limiting (2026-05-22)

- **Phase 2 — Redis-backed rate limiter**: the previous `PartitionedRateLimiter` was strictly in-memory, so deploying every service behind a load balancer multiplied each configured limit by the replica count (a five-instance deployment effectively allowed `5×` the documented `login`, `register`, `auth` and global caps). `AddConfiguredRateLimiting` now takes an `IConfiguration` and, when `RateLimiting:Backend = Redis`, builds the global and named policies via `RedisRateLimitPartition.GetFixedWindowRateLimiter` from `RedisRateLimiting.AspNetCore`, sharing per-IP counters across every replica through Redis. With the setting absent (tests and local dev) the in-memory limiter is used unchanged, so no existing test exercises the new path. `docker-compose.yml` now sets `RateLimiting__Backend: Redis` on every service. Documentation (`docs/auth-security.md`, `docs/configuration.md`) reflects the two backends.

### Mutation testing (2026-05-22)

- Added Stryker.NET as a restorable local tool (`.config/dotnet-tools.json`) with `stryker-config.json` scoping a run to the security-critical hidden-shared-todo visibility helpers (`HiddenTodoDtoFactory`, `TodoViewerStateResolver`).
- The initial run scored 75% — five mutants survived in pure redaction logic, revealing branches the existing handler-level tests did not pin down. Added `HiddenTodoVisibilityTests.cs` with nine direct unit tests (owner vs. non-owner masking, `UserId` redaction, stranger/multi-recipient share detection, legacy global-hide inheritance) and exposed the `internal` helpers to the test project via `InternalsVisibleTo`. The mutation score for that logic is now 95.83%.
- `StrykerOutput/` is git-ignored; `docs/testing.md` documents how to run mutation testing.

### Architecture tests (2026-05-22)

- Added `tests/Planora.UnitTests/Architecture/ArchitectureTests.cs` using `NetArchTest.Rules`. The suite enforces the Clean Architecture / DDD dependency rule automatically: every `*.Domain` assembly is asserted to have no dependency on infrastructure concerns (`*.Infrastructure`, EF Core, ASP.NET Core, Npgsql, Redis, RabbitMQ, gRPC); `BuildingBlocks.Domain` must not depend on the Application or Infrastructure layers; and no `*.Application` project may depend on a sibling service's concrete Infrastructure project or on any Api host. A layering inversion like the one removed from `Realtime.Domain` now fails the build instead of passing review.
- Observation (not yet actioned): the shared messaging contracts (`IEventBus`, `IIntegrationEventHandler`, integration events) live under `Planora.BuildingBlocks.Infrastructure.Messaging`, so Application handlers that publish/consume events depend on an Infrastructure namespace. Relocating those contracts to the Application layer would let the architecture rule cover `BuildingBlocks.Infrastructure` too.

### Security — Phase 3 audit fixes (2026-05-22)

- **High — `IsDevelopmentEnvironment()` not testable via configuration**: `RequireHttpsMetadata` was gated solely on `ASPNETCORE_ENVIRONMENT`, which is not injectable in unit tests. `IsDevelopmentEnvironment()` now first checks `IConfiguration["IsDevelopment"]` (an explicit bool override used in tests and Docker overrides) before falling back to the env var. DI contract tests now pass the key as `"true"` without touching the environment (`Services/AuthApi/Planora.Auth.Infrastructure/DependencyInjection.cs`).
- **High — JWT ClockSkew corrected to zero**: ClockSkew was documented and asserted as `TimeSpan.Zero` across shared `JwtAuthenticationExtensions`, but AuthApi's `AddJwtAuthentication` still set it to 30 seconds. Corrected to `TimeSpan.Zero`; DI contract test assertion updated to match (`Services/AuthApi/Planora.Auth.Infrastructure/DependencyInjection.cs`).
- **High — `ChangeEmailCommandHandler` missing `ISecurityStampService` injection**: The security-stamp rotation added in Phase 2 was wired to the handler constructor but the handler unit test factory was never updated, causing a build error. Test factory updated to inject `Mock.Of<ISecurityStampService>()` (`tests/Planora.UnitTests/Services/AuthApi/Users/Handlers/UserSecurityHandlerTests.cs`).
- **High — `AddCommentCommandHandler` missing friendship gate**: Public-task comments were accessible to any authenticated user regardless of friendship. `AddCommentCommandHandler` now injects `IFriendshipService` and throws `ForbiddenException` when the commenter is neither the owner, a worker, nor a friend of the owner. Worker tests updated to set up `AreFriendsAsync = true`; a new `AddComment_ByNonFriendWithPublicAccess_ShouldThrowForbidden` test asserts the gate (`Services/TodoApi/Planora.Todo.Application/Features/Todos/Commands/AddComment/`, `tests/Planora.UnitTests/Services/TodoApi/Handlers/WorkersAndCommentsHandlerTests.cs`).
- **Medium — `BaseRepository.GetByIdAsync` using `FindAsync` (cross-scope lookup failure)**: `FindAsync` short-circuits through EF Core's identity map and returns `null` for entities saved by a different `DbContext` scope — a systematic bug that caused 404/500 responses on delete and update after create in integration tests. Replaced with `FirstOrDefaultAsync(e => e.Id == guidId)` which always queries the store, working correctly with all providers (`BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Persistence/BaseRepository.cs`).
- **Medium — `SoftDeleteByTodoIdAsync` used `ExecuteUpdateAsync` (InMemory incompatible)**: EF Core's InMemory provider does not support `ExecuteUpdateAsync`/`ExecuteDeleteAsync` bulk operations, causing `DeleteTodo` integration tests to return HTTP 500. Replaced with load-then-`MarkAsDeleted` pattern: loads all active comments for the todo and calls `comment.MarkAsDeleted(deletedBy)` on each, relying on the caller's `UnitOfWork.SaveChangesAsync()` to flush. Comment counts per todo are bounded, so the extra round-trip is negligible (`Services/TodoApi/Planora.Todo.Infrastructure/Persistence/Repositories/TodoCommentRepository.cs`).
- **Fix — `UnhandledExceptionBehavior` removed from MediatR pipeline**: DI contract test was asserting that `UnhandledExceptionBehavior` IS registered; it is intentionally NOT registered (global exception middleware handles unhandled errors). Test assertion changed from `Assert.Contains` to `Assert.DoesNotContain` (`tests/Planora.UnitTests/Services/Infrastructure/DependencyInjectionContractTests.cs`).

### Security — Phase 2 audit fixes

- **Critical — CSP nonce never applied**: the per-request CSP nonce was sent in the response header, but Next.js never received it (CSP was not on the request headers) and every route was statically prerendered, so the strict `script-src` blocked the framework's own inline scripts. The middleware now forwards the CSP on the request headers and the root layout opts every route into dynamic rendering, so Next.js stamps the matching nonce on all inline scripts (`frontend/src/middleware.ts`, `frontend/src/app/layout.tsx`).
- **High — CreateTodo owner spoofing**: `TodosController.CreateTodo` bound `CreateTodoCommand.UserId` from the request body, letting any authenticated user create todos owned by another account. The controller now nulls the field so the owner is always the JWT subject, matching `CategoriesController`/`MessagesController` (`Services/TodoApi/Planora.Todo.Api/Controllers/TodosController.cs`).
- **High — gRPC service-key auth incomplete**: only AuthApi validated the `x-service-key`. `ServiceKeyServerInterceptor` is now registered on the Todo, Category, Messaging, and Realtime gRPC servers as well; both interceptors reject keys shorter than 16 characters at startup (`Services/*/Program.cs`, `BuildingBlocks/.../Grpc/ServiceKey*Interceptor.cs`).
- **High — Data Protection key ring not persisted**: encrypted TOTP secrets became undecryptable after a container restart because the key ring was container-ephemeral. The key ring is now persisted to Redis under `Planora:Auth:DataProtection-Keys` (`Services/AuthApi/.../DependencyInjection.cs`).
- **High — access-token revocation only on AuthApi**: the password-change security stamp was checked only by AuthApi. A shared `SecurityStampValidator` is now invoked from the `OnTokenValidated` hook of every JWT-consuming service (Todo, Category, Messaging, Realtime), so a stolen token is rejected service-wide after a password change (`BuildingBlocks/.../Security/SecurityStampValidator.cs`).
- **Medium — JWT signing-key length not enforced**: the live AuthApi and shared consumer JWT paths now reject a `JwtSettings:Secret` shorter than 32 characters (`Services/AuthApi/.../DependencyInjection.cs`, `BuildingBlocks/.../Extensions/JwtAuthenticationExtensions.cs`, `Planora.ApiGateway/Program.cs`).
- **Medium — API Gateway gRPC clients missing service-key interceptor**: `Planora.ApiGateway` registered five gRPC clients without `ServiceKeyClientInterceptor`, so any call through them would be rejected by the downstream `ServiceKeyServerInterceptor`. `ServiceKeyClientInterceptor` is now registered as a singleton and wired into all five clients via `AddInterceptor<ServiceKeyClientInterceptor>()` (`Planora.ApiGateway/Extensions/ServiceCollectionExtensions.cs`). Note: the gateway currently routes exclusively via Ocelot HTTP and does not inject any of these clients; the fix is defensive.
- **Config**: `GRPC_SERVICE_KEY` is now passed to `realtime-api` in `docker-compose.yml` and documented in `.env.production.example`.
- **Tests**: added unit tests for `SecurityStampValidator` (revocation, claim parsing, fail-open), the gRPC `ServiceKey*Interceptor` pair (key validation, request rejection, and client header injection), and the `CreateTodo` owner-spoofing fix.

### Security — Phase 1 audit fixes

- **Critical — TOTP replay protection**: `TwoFactorService` previously discarded the `out long timeStepMatched` parameter, making it impossible to detect replay attacks within a 5-step window. Rewritten to capture the matched time-step and atomically record it in Redis (`SETNX totp:used:{userId}:{step}`, TTL=3 min). Service fails closed when Redis is unavailable. Interface updated to async `VerifyCodeAsync(string, string, Guid, CancellationToken)` (`Services/AuthApi/Planora.Auth.Infrastructure/Services/Authentication/TwoFactorService.cs`).
- **Critical — IDOR on `/friend-ids` and `/are-friends`**: Endpoints accepted any `userId` path parameter without comparing it to the caller's JWT `sub` claim. Added explicit ownership check; returns HTTP 403 on mismatch (`Services/AuthApi/Planora.Auth.Api/Controllers/FriendshipsController.cs`).
- **Critical — Soft-delete filter gap in TodoRepository**: Five query methods were missing `!t.IsDeleted`, exposing soft-deleted todos. Added filter to all five; `GetByUserId` intentionally unchanged (used by deletion cleanup consumer) (`Services/TodoApi/Planora.Todo.Infrastructure/Persistence/Repositories/TodoRepository.cs`).
- **High — Cookie `Secure` flag behind reverse proxy**: `AuthenticationController` used `Secure = HttpContext.Request.IsHttps` on all five cookie paths. Behind a TLS-terminating proxy this evaluates to `false`. Replaced with `SecureCookie = !_env.IsDevelopment()` via `IWebHostEnvironment` (`Services/AuthApi/Planora.Auth.Api/Controllers/AuthenticationController.cs`).
- **High — Revoked friends retained shared-todo access**: Friendship removal never cleaned up `TodoItemShare` rows, so ex-friends could still comment on shared todos. Added `FriendshipRemovedIntegrationEvent` published from `RemoveFriendCommandHandler`; new `FriendshipRemovedEventConsumer` in TodoApi removes stale share rows in both directions (`BuildingBlocks/…/Events/FriendshipRemovedIntegrationEvent.cs`, `Services/TodoApi/…/FriendshipRemovedEventConsumer.cs`).
- **High — JWT ClockSkew mismatch**: Auth service used 5-minute clock skew vs. 30 seconds in shared extension. Corrected to 30 seconds (`Services/AuthApi/Planora.Auth.Infrastructure/DependencyInjection.cs`).
- **High — `IsDevelopment` from freeform config key**: `RequireHttpsMetadata` was gated on a config key that could be set by accident. Changed to read `ASPNETCORE_ENVIRONMENT` directly.
- **High — Notification type injection**: `SendNotification` accepted arbitrary strings as notification type, allowing injection into connected SignalR sessions. Added static `AllowedNotificationTypes` allowlist; unknown types → HTTP 400 (`Services/RealtimeApi/Planora.Realtime.Api/Controllers/NotificationsController.cs`).
- **High — Next.js `serverActions.allowedOrigins` misconfiguration**: Both branches of the ternary evaluated to `[]`. Fixed so `localhost:3000` is only allowed in development (`frontend/next.config.js`).
- **Medium — PII in application logs**: Email addresses removed from INFO/WARNING log messages across `AuthenticationController`, `LoginCommandHandler`, and `RegisterCommandHandler`; one duplicate-email warning retains only the email domain.
- **Medium — `isAuthenticated` persisted to sessionStorage**: After page reload, rehydration restored `isAuthenticated: true` with no `accessToken`, creating a false-positive window before `restoreSession()` ran. Removed from `partialize`; flag now starts `false` on rehydration (`frontend/src/store/auth.ts`).

### Known security limitations (tracked, not yet fixed)

- **Medium — `style-src 'unsafe-inline'` in production CSP**: `script-src` is now nonce-based, but `style-src` still allows `'unsafe-inline'` because Tailwind and Next.js inject critical CSS as inline `<style>` tags during SSR (`frontend/src/middleware.ts`). Removing it requires nonce/hash support for inline styles.
- **Medium — token blacklist/security-stamp checks fail open on Redis outage**: `TokenBlacklistFilter` and `SecurityStampValidator` return "not revoked" if Redis is unavailable, trading strict revocation for availability. Documented trade-off.
- **Low — gateway gRPC clients unused**: `Planora.ApiGateway` registers five gRPC clients (and `AuthGrpcClient`) that are not currently injected anywhere; the gateway routes requests via Ocelot HTTP. Clients now carry `ServiceKeyClientInterceptor` (see Phase 2 fixes above) so they are ready if active use is added.

### Security — prior fixes

- Fixed: `GlobalLimiter` was commented out in `AddConfiguredRateLimiting()`, leaving all data endpoints without rate limiting. Replaced with a working `PartitionedRateLimiter` (100 req/min per IP) so every service has a baseline cap without requiring per-controller annotations (`BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Extensions/ServiceCollectionExtensions.cs`).
- Fixed: `NotificationHub.Subscribe()` accepted any arbitrary group string, allowing a user to subscribe to channels of other users. Added a static `AllowedTopics` whitelist `{system, announcements, todos}`; requests for other topics are rejected with a warning log (`Services/RealtimeApi/Planora.Realtime.Infrastructure/Hubs/NotificationHub.cs`).
- Fixed: All 6 service `Program.cs` files contained copy-pasted inline lambdas setting weaker `style-src 'unsafe-inline'` CSP headers. Added `UseSecurityHeaders()` extension method to `SecurityHeadersMiddleware` and replaced all inline lambdas with the single shared, stricter implementation.

### CI / CD

- `dotnet build` now passes `-warnaserror` flag; warnings are treated as errors in Release builds (`.github/workflows/ci.yml`).
- Frontend CI switched from `rm -f package-lock.json && npm install` to `npm ci` with correct `cache-dependency-path: frontend/package-lock.json` for reproducible installs (`.github/workflows/ci.yml`, `.github/workflows/e2e.yml`).
- E2E workflow gained `permissions: contents: read` and `concurrency` group with `cancel-in-progress: true` (`.github/workflows/e2e.yml`).
- Added `permissions: contents: read` (minimum principle) and `security-events: write` to GitHub Actions workflows.
- Added `concurrency` groups to cancel duplicate in-progress runs on the same branch.
- Added `timeout-minutes` to every CI job (10 min docs/security, 15 min frontend, 20 min backend).
- Extended push triggers to include `claude/**` branches.
- Added `github-actions` ecosystem to Dependabot so action version references are kept up to date automatically (`.github/dependabot.yml`).

### Tests

- Vitest coverage thresholds enforced: lines/functions/statements ≥ 85 %, branches ≥ 80 % — CI now fails if coverage drops below these baselines (`frontend/vitest.config.ts`).
- Added `frontend/src/test/components/worker-and-comments.test.tsx` with 36 tests covering `WorkerJoinButton` (all 4 render states, pending/debounce, hover callbacks) and `TaskComments` (load/empty/render, add/edit/delete CRUD, keyboard shortcuts, time-display branches, pagination). Frontend branch coverage: 81.88% → 85.11%.

## [1.0.0] — 2026-05-10

### Highlights

First public release of Planora — a .NET 9 microservice backend with a Next.js 15 frontend for personal productivity management.

## [0.1.0] — 2026-04-24

### Frontend — Visual Design

- Added `TopologyBackground` canvas component (`frontend/src/components/backgrounds/topology-background.tsx`): animated off-white marching-squares contour field applied globally to every page via the root layout.
  - Scalar field built from three overlapping sine/cosine waves; 9 contour levels rendered with a single `beginPath/stroke` per level for efficiency.
  - Cursor ripple distortion via passive `pointermove` listener on `window`; click ripple rings via `pointerdown`.
  - Ambient blobs (warm + cool radial gradients) pre-rendered once into an offscreen `HTMLCanvasElement` and blitted per frame.
  - DPR-aware canvas resize: pixel ratio capped at ×2, `alpha: false` context, `setTransform` scale — saves ~15–20 % render time on hi-DPI screens.
  - Adaptive grid: 32/42/52/60 cells depending on viewport width; FPS watchdog auto-lowers grid by 10 if average drops below 40 fps over the first 60 frames.
  - Pauses automatically on hidden tab (`visibilitychange`), offscreen canvas (`IntersectionObserver`), and `prefers-reduced-motion: reduce` (single static frame).
  - `aria-hidden="true"`, `pointer-events-none`, `fixed inset-0 -z-10` — purely decorative, never intercepts clicks.
- Added `TopologyLayer` client wrapper (`frontend/src/components/backgrounds/topology-layer.tsx`) — a `lazy`-loaded `Suspense` boundary imported once in the root layout.
- Extended `PageBackground` with optional `variant?: "static" | "topology"` prop for opt-in per-component use.
- Updated root layout body background from `bg-white` to `bg-[#f8f7f4]` (matches canvas base color — eliminates FOUC flash).
- Refreshed landing page copy: updated hero headline, subheading, badge text, feature card descriptions, and footer line.
- Landing page feature cards and nav updated with glass morphism tokens (`bg-white/50 backdrop-blur-sm`, `border-white/60`) for visual coherence with the animated canvas beneath them.

### Documentation

- Rebuilt the documentation structure around a central docs index.
- Added detailed guides for overview, getting started, configuration, architecture, codebase map, features, API, database, security, testing, deployment, development, troubleshooting, FAQ, and glossary.
- Clarified confirmed behavior around Next.js 15, httpOnly refresh cookies, CSRF, hidden shared todo redaction, gateway routes, database ownership, and local Docker/startup configuration.
- Added production deployment baseline, secret management guide, and production environment template.
- Added a public security disclosure policy that uses GitHub Private Vulnerability Reporting.

### CI / QA

- Added markdownlint and offline Markdown link checks to CI.
- Added Docker-backed Playwright e2e coverage for auth, email verification, friendship, shared todos, and hidden viewer preference behavior.
- Excluded generated Playwright e2e specs from Vitest unit-test discovery.

### Repository Hygiene

- Added repository rules for Graphify-first analysis and mandatory documentation synchronization after behavior/config/test changes.
- Ignored AI/agent-local state, generated build artifacts, `tsconfig.tsbuildinfo`, and generated EF `Migrations/` folders.
- Expanded repository hygiene ignores for nested assistant/tooling state, MCP config, local assistant prompts, and generated chat/history artifacts.
- Removed tracked Claude local settings, Obsidian workspace/plugin state, frontend build output, frontend TypeScript build info, and generated EF migration files.
- Hardened `.dockerignore` so local agent/editor state, Graphify output, tests, docs, build artifacts, and generated migrations stay out of Docker build contexts.
- Bound RabbitMQ AMQP to `127.0.0.1:5672` in local Compose and added a runtime contract assertion for the localhost binding.
- Replaced a JWT-shaped test fixture with a non-token invalid bearer value to reduce false positives in secret scanners.
- Added database startup fallback that creates schema from the current EF model when no user-owned migrations exist.

### Project Metadata

- Added MIT license.

[1.0.0]: https://github.com/4Keyy/Planora/releases/tag/v1.0.0
[0.1.0]: https://github.com/4Keyy/Planora/releases/tag/v0.1.0
