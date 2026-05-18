# Changelog

All notable changes to Planora are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

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

- **Critical — TOTP secret stored in plaintext**: `TwoFactorSecret` has no `HasConversion` encryption in EF Core configuration (`Services/AuthApi/Planora.Auth.Infrastructure/Persistence/Configurations/UserConfiguration.cs:47`). Requires ASP.NET Data Protection API integration.
- **Critical — gRPC endpoints unauthenticated**: All four gRPC services accept caller-supplied `UserId` with no server-side JWT validation. Architectural change needed (add `[Authorize]` + forward JWT from gateway).
- **High — Access tokens not blacklisted on password reset**: Refresh tokens are revoked on password change, but existing access tokens remain valid until expiry (up to 60 min in Docker). A per-user "security stamp" in Redis with JWT `iat` comparison would fix this.
- **High — No 2FA recovery codes**: Password reset bypasses 2FA; no backup codes exist for account recovery.
- **High — `style-src 'unsafe-inline'` in production CSP**: Requires nonce injection via Next.js Middleware to remove `unsafe-inline`.

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
