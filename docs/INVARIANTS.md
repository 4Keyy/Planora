# Planora Architectural Invariants

These are **closed-form rules** that hold across the system at all times. Violations are reverted, not negotiated. Each invariant carries the evidence and the enforcement plan.

This file is short by design. If a rule belongs here, it belongs forever. Items with conditional or temporary status live in [docs/ROADMAP.md](ROADMAP.md) instead.

---

## Service Ownership

**INV-OWN-1.** Each domain owns its own PostgreSQL database. No service reads or writes another service's tables.
- Domain → DB mapping: Auth → `planora_auth_db`; Todo → `planora_todo`; Category → `planora_category`; Messaging → `planora_messaging`. Realtime currently has no DB ([CSP-6](../C:/Users/fkeyy/Desktop/Planora-MASTER-PLAN.md)).
- Cross-service reads happen via gRPC (synchronous) or RabbitMQ integration events (asynchronous), never via shared DB schemas.
- Enforcement: `docker-compose.yml` connection-string envs are scoped per service; PR review rejects cross-service `ConnectionStrings__` references.

**INV-OWN-2.** Identity is owned by Auth. No other service mints, validates, or rotates JWT/refresh tokens. Friendship existence is owned by Auth.
- Evidence: `Services/AuthApi/Planora.Auth.Api/Controllers/AuthenticationController.cs`, `Services/AuthApi/Planora.Auth.Domain/Entities/Friendship.cs`.

**INV-OWN-3.** Todo never reads Auth DB directly. Friend-list lookups go through `IFriendshipService` → gRPC. Avatar enrichment goes through `GetUserAvatarsBatch` gRPC.
- Evidence: `docs/architecture.md:166-171`.

---

## Cross-service Communication

**INV-COMM-1.** All synchronous internal calls go through gRPC contracts in `GrpcContracts/Protos/`. Internal HTTP-to-HTTP calls between services are forbidden.
- Exception: API Gateway is the only HTTP ingress; it never makes internal HTTP calls except to its own health endpoints.

**INV-COMM-2.** Every gRPC server registers `ServiceKeyServerInterceptor`. Every gRPC client uses `ServiceKeyClientInterceptor`. Calls without a matching `x-service-key` are rejected with `Unauthenticated`. Until [CSP-3](../C:/Users/fkeyy/Desktop/Planora-MASTER-PLAN.md) (mTLS migration) lands, this is the only line of defence for the backplane.
- Evidence: `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Grpc/ServiceKeyServerInterceptor.cs`, `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Grpc/ServiceKeyClientInterceptor.cs`.

**INV-COMM-3.** Integration events flow through the Outbox pattern only. Code must not call `IEventBus.Publish` directly from a request handler — events are written into the service's outbox table inside the same DB transaction as the business mutation, and `OutboxProcessor` ships them to RabbitMQ.
- Evidence: `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Outbox/OutboxProcessor.cs`.
- Rationale: at-least-once delivery; atomicity with business state.

**INV-COMM-4.** Every integration-event consumer uses the Inbox pattern (`IIdempotentMessageHandler`) to deduplicate messages by `messageId`. Handlers must be idempotent under replay.
- Evidence: `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/IdempotentConsumer/IdempotentMessageHandler.cs`.

---

## Authentication & Sessions

**INV-AUTH-1.** Access tokens live **only in frontend memory**. They are never persisted to `localStorage`, `sessionStorage`, or any cookie.
- Evidence: `frontend/src/store/auth.ts` (Zustand persist includes user metadata + expiry, not the raw token).

**INV-AUTH-2.** Refresh tokens live **only in an httpOnly + SameSite=Strict cookie**, scoped to `/auth/api/v1/auth`. The frontend cannot read them. They are never returned in response bodies.
- Evidence: `Services/AuthApi/Planora.Auth.Api/Controllers/AuthenticationController.cs`, ADR-0002.

**INV-AUTH-3.** State-changing browser requests to Auth API carry the double-submit CSRF token (`X-CSRF-Token` header + readable `XSRF-TOKEN` cookie). Validation is constant-time.
- Evidence: `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Middleware/CsrfProtectionMiddleware.cs`, ADR-0003.
- Open question: services other than Auth do not run CSRF middleware ([Phase 2 T2.6](../C:/Users/fkeyy/Desktop/Planora-MASTER-PLAN.md)).

**INV-AUTH-4.** Password change invalidates **all** existing access tokens for that user via security stamp rotation. Subsequent requests with old tokens return `401`.
- Evidence: `Services/AuthApi/Planora.Auth.Api/Filters/TokenBlacklistFilter.cs`, `Services/AuthApi/Planora.Auth.Infrastructure/Services/Security/SecurityStampService.cs`.

**INV-AUTH-5.** TOTP secrets are encrypted at rest with ASP.NET Core Data Protection, keys persisted to Redis under `Planora:Auth:DataProtection-Keys`, scoped to application name `Planora.Auth`. Recovery codes are hashed with BCrypt before storage.
- Evidence: `Services/AuthApi/Planora.Auth.Infrastructure/Persistence/AuthDbContext.cs`, `Services/AuthApi/Planora.Auth.Infrastructure/DependencyInjection.cs`.

---

## Authorization & Privacy

**INV-AZ-1.** Every controller action that touches user-owned data is either `[Authorize]` or explicitly declared anonymous and reviewed. Anonymous endpoints are exhaustively listed in `docs/auth-security.md`. Anything not listed must be authorized.

**INV-AZ-2.** Admin-only endpoints carry `[Authorize(Roles = "Admin")]`. Role assignment happens in Auth DB seed only. Application code never grants `Admin` from request input.

**INV-AZ-3.** Hidden shared/public todos are **redacted server-side** via `HiddenTodoDtoFactory`. The frontend never receives sensitive content for a hidden todo. Visual fields (`Priority`, `IsPublic`, `HasSharedAudience`, `IsVisuallyUrgent`) are preserved for non-content frame rendering.
- Evidence: `Services/TodoApi/Planora.Todo.Application/Features/Todos/HiddenTodoDtoFactory.cs`, ADR-0004.

**INV-AZ-4.** Todo comment threads require an accepted friendship between the viewer and the todo owner (when the todo is shared/public). Friendship check is mandatory in the comment handler.
- Evidence: commit `5a3a83e` — "require friendship to read todo comments".

---

## Data Integrity

**INV-DATA-1.** Every domain mutation goes through an aggregate root method. Setters on entities are not used to mutate state from application code. Validation lives in domain methods + FluentValidation validators.

**INV-DATA-2.** EF Core `SaveChangesAsync` is the only commit primitive. Multi-table mutations within a service happen in a single transaction. The outbox row is in the same transaction as the business mutation.

**INV-DATA-3.** Read-only queries use `.AsNoTracking()`. Mutating workflows do not.

**INV-DATA-4.** Soft-deleted rows are filtered by global query filters. Admin/audit paths that need to see deleted rows must call `.IgnoreQueryFilters()` explicitly and document the reason in code.

---

## Configuration & Secrets

**INV-CFG-1.** Secrets never appear in `appsettings.json`, `appsettings.*.json` committed to git, code, comments, or test fixtures. Secrets come from environment variables in dev/CI and from a secret manager in production.
- Tooling: gitleaks runs in `.github/workflows/security.yml` with Planora-specific rules in `.gitleaks.toml`.

**INV-CFG-2.** Docker-compose required secrets use the strict form `${VAR:?VAR env var must be set}`. Stack does not start with a missing required secret.
- Evidence: `docker-compose.yml`.

**INV-CFG-3.** `GRPC_SERVICE_KEY` and `JwtSettings__Secret` are validated at service startup by `ConfigurationValidator` (minimum 16 chars for service key, minimum 32 chars for JWT secret). Failure aborts startup, never falls back to a default.

---

## API Surface (until [Phase 2 T2.1](../C:/Users/fkeyy/Desktop/Planora-MASTER-PLAN.md) lands)

**INV-API-1.** Error responses follow `ApiResponse<object>.Failed(...)` shape produced by `EnhancedGlobalExceptionMiddleware`. New controllers must not throw raw `Exception` to client — they let middleware translate it.

**INV-API-2.** Success responses currently take one of three shapes (`Result<T>`, `PagedResult<T>` wrapper, or raw DTO). Frontend reads them through `parseApiResponse`. **New endpoints prefer raw DTO** to keep migration to RFC 7807 cheap. Do not introduce a fourth shape.

---

## Observability (until [Phase 1 T1.1](../C:/Users/fkeyy/Desktop/Planora-MASTER-PLAN.md) lands)

**INV-OBS-1.** Every request gets a correlation id via `CorrelationIdMiddleware`. Every log line carries `CorrelationId`, `SpanId`, `OperationName`, `UserId` (when present), and `ServiceName` via Serilog enrichers.

**INV-OBS-2.** Auth-sensitive log lines never contain the bearer token, refresh token, password, TOTP code, or recovery code. Logging of `Authorization` headers in API Gateway is suppressed by configuration.

**INV-OBS-3.** Business events go through `IBusinessEventLogger`. They are structured logs, not free-form `_logger.LogInformation`.

---

## CI Quality Gates

**INV-CI-1.** `dotnet build -warnaserror` and `npm run lint` + `npm run type-check` must be green on every PR. `Directory.Build.props` sets `TreatWarningsAsErrors=true` for backend.

**INV-CI-2.** `dotnet test` (unit + integration + ErrorHandling tests) and `npm run test:coverage` must be green on every PR.

**INV-CI-3.** Security pipeline runs on every PR and weekly schedule: gitleaks, `dotnet list package --vulnerable`, `npm audit --audit-level=moderate`, CodeQL SAST (csharp + javascript-typescript), Trivy IaC. A new HIGH or CRITICAL finding must be triaged before merge.

**INV-CI-4.** E2E pipeline (`docker compose up` + Playwright) must pass for any PR that touches `BuildingBlocks/**`, `GrpcContracts/**`, `Planora.ApiGateway/**`, `Services/**`, `frontend/**`, `docker-compose.yml`, or `postgres/**`.

---

## Workflow & Commit Hygiene

**INV-FLOW-1.** Migrations are committed alongside the schema change that produced them. A schema change is never merged without its EF migration.

**INV-FLOW-2.** Runtime user uploads (`Services/AuthApi/Planora.Auth.Api/wwwroot/avatars/`) and other generated content are gitignored. They never appear in `git status` of a clean working tree.

**INV-FLOW-3.** Conventional commits: `feat / fix / docs / style / refactor / perf / test / chore / ci / build`. Each commit ships one logical unit, with docs updated as part of the same commit when behavior or contracts changed.

---

## What this file is not

- This is not a style guide. Style lives in `.editorconfig`.
- This is not a roadmap. Future work lives in `docs/ROADMAP.md` and the master plan at `C:\Users\fkeyy\Desktop\Planora-MASTER-PLAN.md` (off-repo).
- This is not aspirational. Every rule above is currently observable in code, configuration, or CI.

When [Phase 2](../C:/Users/fkeyy/Desktop/Planora-MASTER-PLAN.md) closes the API-response and Realtime-persistence gaps, the corresponding caveats above are removed and the rule is tightened.
