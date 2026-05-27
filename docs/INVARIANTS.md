# Planora Architectural Invariants

These are **closed-form rules** that hold across the system at all times. Violations are reverted, not negotiated. Each invariant carries the evidence and the enforcement plan.

This file is short by design. If a rule belongs here, it belongs forever. Items with conditional or temporary status live in [docs/ROADMAP.md](ROADMAP.md) instead.

---

## Service Ownership

**INV-OWN-1.** Each domain owns its own PostgreSQL database. No service reads or writes another service's tables.

- Domain → DB mapping: Auth → `planora_auth_db`; Todo → `planora_todo`; Category → `planora_category`; Messaging → `planora_messaging`. Realtime currently has no DB (CSP-6).
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

**INV-COMM-2.** Every gRPC server registers `ServiceKeyServerInterceptor`. Every gRPC client uses `ServiceKeyClientInterceptor`. Calls without a matching `x-service-key` are rejected with `Unauthenticated`. Until CSP-3 (mTLS migration) lands, this is the only line of defence for the backplane.

- Evidence: `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Grpc/ServiceKeyServerInterceptor.cs`, `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Grpc/ServiceKeyClientInterceptor.cs`.

**INV-COMM-3.** Integration events flow through the Outbox pattern only. Code must not call `IEventBus.Publish` directly from a request handler — events are written into the service's outbox table inside the same DB transaction as the business mutation, and `OutboxProcessor` ships them to RabbitMQ.

- Evidence: `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Outbox/OutboxProcessor.cs`.
- Rationale: at-least-once delivery; atomicity with business state.

**INV-COMM-3a.** `OutboxMessage` owns its retry / dead-letter state machine. The processor never sets `Status` directly — it calls `MarkAsFailed` (for transient errors) or `MarkAsDeadLettered` (for shape errors that cannot recover on replay, such as `Type.GetType` returning null or `JsonSerializer.Deserialize` returning null). `MarkAsFailed` increments `RetryCount`; while retries remain it schedules `NextRetryUtc` and leaves the row in `Pending`; once the budget is exhausted it auto-transitions to the terminal `OutboxMessageStatus.DeadLettered` and clears `NextRetryUtc` so the polling WHERE clause cannot re-pick the row.

- Evidence: `BuildingBlocks/Planora.BuildingBlocks.Application/Outbox/OutboxMessage.cs`, `OutboxMessageStatus.cs`, `tests/Planora.UnitTests/Services/Infrastructure/OutboxMessageStateMachineTests.cs`.
- Rationale: a previous implementation re-failed exhausted messages on every cycle forever because `Status == Failed && NextRetryUtc <= now` stayed true with a stale timestamp. The terminal `DeadLettered` state — never picked by the polling predicate — eliminates the cycle. Replay after a fix is an operator action (manual SQL update from `DeadLettered` back to `Pending` after the root cause is corrected); the processor never resurrects dead-lettered rows on its own.

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
- Open question: services other than Auth do not run CSRF middleware (Phase 2 T2.6).

**INV-AUTH-4.** Every command that materially changes the security posture of an account rotates the user's security stamp, so any access token issued before the change is rejected on its next authenticated request. The list is exhaustive:

- password change (`ChangePasswordCommandHandler`);
- password reset (`ResetPasswordCommandHandler`);
- email change confirmation (`ChangeEmailCommandHandler`);
- 2FA disable (`Disable2FACommandHandler`);
- revoke all sessions (`RevokeAllSessionsCommandHandler`);
- account soft-delete (`DeleteUserCommandHandler`).

Stamp rotation runs **only on successful execution** — a wrong-password attempt MUST NOT invalidate active sessions, otherwise an observer can DoS the user. Stamp rotation is NOT triggered on 2FA enable or 2FA confirm because enabling strengthens the account; invalidating live sessions there would be friction without security benefit.

Stamp rotation is meaningless unless **every** JWT-accepting service enforces the check on every authenticated request. All five services — Auth, Category, Todo, Messaging, Realtime — wire `SecurityStampValidator.IsTokenRevokedAsync` into `JwtBearerOptions.OnTokenValidated`. Auth API enforces this in `Planora.Auth.Infrastructure.DependencyInjection.AddJwtAuthentication`; consumer services use the shared `AddJwtAuthenticationForConsumer` or an equivalent inline hook. The coverage table lives in `docs/auth-security.md` § "Stamp enforcement coverage".

- Evidence: `Services/AuthApi/Planora.Auth.Api/Filters/TokenBlacklistFilter.cs`, `Services/AuthApi/Planora.Auth.Infrastructure/Services/Security/SecurityStampService.cs`, `Services/AuthApi/Planora.Auth.Infrastructure/DependencyInjection.cs` (Auth's `AddJwtAuthentication`), the six command handlers listed above, and `tests/Planora.UnitTests/Services/AuthApi/Infrastructure/AuthJwtStampWiringTests.cs` which pins the Auth wiring. Regression tests under `tests/Planora.UnitTests/Services/AuthApi/Users/Handlers/` pin the stamp call for success paths and its absence for failure paths.

**INV-AUTH-5.** TOTP secrets are encrypted at rest with ASP.NET Core Data Protection, keys persisted to Redis under `Planora:Auth:DataProtection-Keys`, scoped to application name `Planora.Auth`. Recovery codes are hashed with BCrypt before storage.

- Evidence: `Services/AuthApi/Planora.Auth.Infrastructure/Persistence/AuthDbContext.cs`, `Services/AuthApi/Planora.Auth.Infrastructure/DependencyInjection.cs`.

**INV-AUTH-6.** Refresh-token rotation enforces **reuse detection**. When `RefreshTokenCommandHandler` is presented with a refresh-token value that is already revoked with reason `"Replaced by new token"`, the entire refresh-token chain for that user is revoked (reason `"Reuse detected — chain invalidated"`) and the user's security stamp is rotated. Both effects are persisted in the same SaveChangesAsync call as the revocation. The handler returns Unauthorized; no new token is minted.

- Evidence: `Services/AuthApi/Planora.Auth.Application/Features/Authentication/Handlers/RefreshToken/RefreshTokenCommandHandler.cs`, `tests/Planora.UnitTests/Services/AuthApi/Authentication/Handlers/AuthLifecycleHandlerTests.cs::RefreshToken_WhenReplayed_InvalidatesChainAndRotatesStamp`.
- Rationale: a replayed rotated token is either a buggy client racing its own refresh or — much more likely — an attacker presenting a stolen value. Invalidating the chain logs the legitimate user out across all devices and, paired with stamp rotation, immediately retires every minted access token. The user must re-authenticate; the attacker is left holding revoked credentials.

**INV-AUTH-7.** Every JWT-validating wiring point reads `ClockSkew` from one source — `Planora.BuildingBlocks.Infrastructure.Configuration.SecurityConstants.SecurityPolicies.TokenClockSkewSeconds`. No service writes a literal `TimeSpan.Zero` or numeric seconds value into `TokenValidationParameters.ClockSkew`. The pinned tests at `tests/Planora.UnitTests/Services/AuthApi/Configuration/AuthApiConfigurationTests.cs` and `tests/Planora.UnitTests/Services/Infrastructure/DependencyInjectionContractTests.cs` assert the value matches the constant.

- Evidence: `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Configuration/SecurityConstants.cs:126`, every JWT bearer registration across Auth, Todo, Category, Messaging, Realtime, Gateway, and the standalone TokenService validation paths.
- Rationale: pre-audit, six wiring points used `TimeSpan.Zero`, one used `30 s`, one used `5 s`, and the central `TokenClockSkewSeconds = 5` constant was unused. The divergence produced intermittent 401s under NTP drift between Fly machines. A single source eliminates the entire class of clock-skew regressions.

---

## Authorization & Privacy

**INV-AZ-1.** Every controller action that touches user-owned data is either `[Authorize]` or explicitly declared anonymous and reviewed. Anonymous endpoints are exhaustively listed in `docs/auth-security.md`. Anything not listed must be authorized.

**INV-AZ-2.** Admin-only endpoints carry `[Authorize(Roles = "Admin")]`. Role assignment happens in Auth DB seed only. Application code never grants `Admin` from request input.

**INV-AZ-3.** Hidden shared/public todos are **redacted server-side** via `HiddenTodoDtoFactory`. The frontend never receives sensitive content for a hidden todo. Visual fields (`Priority`, `IsPublic`, `HasSharedAudience`, `IsVisuallyUrgent`) are preserved for non-content frame rendering.

- Evidence: `Services/TodoApi/Planora.Todo.Application/Features/Todos/HiddenTodoDtoFactory.cs`, ADR-0004.

**INV-AZ-4.** Todo comment threads require an accepted friendship between the viewer and the todo owner (when the todo is shared/public). Friendship check is mandatory in the comment handler.

- Evidence: commit `5a3a83e` — "require friendship to read todo comments".

**INV-AZ-5.** User-uploaded avatars are server-validated, re-encoded to WebP, and stripped of EXIF/ICC/XMP metadata before persistence. Raw bytes from `IFormFile` never reach disk. Only `image/jpeg`, `image/png`, `image/webp` are accepted, capped at 5 MB and 4096×4096; magic bytes are sniffed regardless of declared `Content-Type`. Storage is content-addressed under `/avatars/{userId}/{contentHash}/{size}.webp` and served with `Cache-Control: public, max-age=31536000, immutable`.

- Evidence: `Services/AuthApi/Planora.Auth.Application/Features/Users/Validators/UploadAvatar/UploadAvatarCommandValidator.cs`, `Services/AuthApi/Planora.Auth.Infrastructure/Services/Common/{ImageSharpImageProcessor,LocalAvatarStorage}.cs`, `Services/AuthApi/Planora.Auth.Api/Program.cs`, `docs/auth-security.md` § Avatar File Pipeline.

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

## API Surface (until Phase 2 T2.1 lands)

**INV-API-1.** Error responses follow `ApiResponse<object>.Failed(...)` shape produced by `EnhancedGlobalExceptionMiddleware`. New controllers must not throw raw `Exception` to client — they let middleware translate it.

**INV-API-2.** Success responses currently take one of three shapes (`Result<T>`, `PagedResult<T>` wrapper, or raw DTO). Frontend reads them through `parseApiResponse`. **New endpoints prefer raw DTO** to keep migration to RFC 7807 cheap. Do not introduce a fourth shape.

---

## Observability (until Phase 1 T1.1 lands)

**INV-OBS-1.** Every request gets a correlation id via `CorrelationIdMiddleware`. Every log line carries `CorrelationId`, `SpanId`, `OperationName`, `UserId` (when present), and `ServiceName` via Serilog enrichers.

**INV-OBS-2.** Auth-sensitive log lines never contain the bearer token, refresh token, password, TOTP code, or recovery code. Logging of `Authorization` headers in API Gateway is suppressed by configuration.

**INV-OBS-3.** Business events go through `IBusinessEventLogger`. They are structured logs, not free-form `_logger.LogInformation`.

**INV-OBS-4.** Every service exposes three health-probe endpoints: `/health/live` (process liveness, no external deps), `/health/ready` (dependencies reachable, ready to accept traffic), and `/health` (aggregate, retained for backwards-compatible consumers like docker-compose). Wiring is centralized in `MapPlanoraHealthEndpoints()`; services do not call `MapHealthChecks` directly. Liveness checks carry tag `live`, readiness checks carry tag `ready`.

- Evidence: `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Extensions/HealthCheckExtensions.cs`.
- Rationale: orchestrators (Fly.io machines, k8s) need distinct liveness vs readiness semantics; aggregate `/health` cannot distinguish "process is dead, restart me" from "I'm alive but Postgres is slow, don't route to me yet".

**INV-OBS-5.** Every backend service and the API Gateway wire OpenTelemetry through the single shared `TelemetryConfiguration.AddPlanoraTelemetry(...)` extension. Services do not call `services.AddOpenTelemetry()` directly **and do not introduce per-service wrappers** around `AddPlanoraTelemetry`. The pipeline is no-op when `OTEL_EXPORTER_OTLP_ENDPOINT` (or `OpenTelemetry:OtlpEndpoint`) is unset — no exporters, no background connections, no log noise — while still recording in-process traces and metrics so any future exporter can be added without code changes. Custom activity sources and meters published as `Planora.*` are auto-discovered. `/health*` paths are excluded from request tracing to suppress probe noise. EF Core SQL text capture (`SetDbStatementForText`) is **off by default** and opted in per environment via `OpenTelemetry:Tracing:CaptureDbStatementText=true` — keeping potential PII in parameter values out of trace exports unless the operator consciously enables it.

- Evidence: `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Logging/TelemetryConfiguration.cs`, every service `Program.cs` (each calls `builder.Services.AddPlanoraTelemetry(...)` directly).
- Rationale: a single instrumentation surface means one place to add new instrumentations (gRPC client, RabbitMQ, SignalR), one place to configure sampling and resource attributes, and one place to flip exporters between vendors. Wrapper helpers around the canonical call invariably drift — Auth API used to ship an `AddOpenTelemetryConfiguration` wrapper that survived two refactors before the audit deleted it.

**INV-OBS-6.** Custom Planora metrics are published through one shared `Meter` named `Planora.BuildingBlocks` defined in `BuildingBlocks.Infrastructure.Observability.PlanoraMetrics`. Services do not create their own `Meter` instances for cross-cutting concerns. New instruments follow OpenTelemetry semantic conventions: explicit units (`s`, `{rejection}`, `{message}`), low-cardinality tag values from a finite enumeration, and `_total` is implicit (added by the Prometheus exporter, not the instrument name).

- Evidence: `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Observability/PlanoraMetrics.cs`.
- Currently published: `planora.csrf.rejections{reason}`, `planora.grpc.unauthenticated{reason}`, `planora.outbox.messages{outcome}`, `planora.outbox.batch.duration` (histogram, seconds), `planora.outbox.message.age` (histogram, seconds).
- Rationale: one meter = one configuration knob in `AddMeter("Planora.*")` (already wildcard-subscribed by `AddPlanoraTelemetry`), one place to audit cardinality before shipping to a metrics backend that bills per series.

**INV-OBS-7.** Centralized logs ship through Grafana Loki via `SerilogConfiguration.TryAddLokiSink`. The sink is registered only when `LOKI_URL` (or `Serilog:Loki:Url`) is set; with no URL the helper returns false and no sink is added, so there is no background connection and no log noise. Both Serilog configuration entry points (`WebApplicationBuilder` and `IHostBuilder`) call the same helper — there is one implementation. Labels are restricted to `service_name` and `environment`; per-request labels are forbidden to bound cardinality.

- Evidence: `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Logging/SerilogConfiguration.cs`, `tests/Planora.UnitTests/Services/Infrastructure/SerilogConfigurationTests.cs`.
- Rationale: a single sink registration path is testable in isolation; the no-op-on-missing-URL behaviour means activating Loki is a single secret change rather than a code or release cycle.

**INV-OBS-8.** The frontend emits a W3C `traceparent` header on every outbound API request via the axios request interceptor in `frontend/src/lib/api.ts`. The trace-id and span-id are generated by the in-bundle helper at `frontend/src/lib/trace.ts` (no OpenTelemetry SDK dependency in the browser); the all-zero trace-id reserved by the spec is re-rolled. Callers may pre-set `config.headers.traceparent` to group multiple requests under one trace; the interceptor only fills it in when absent.

- Evidence: `frontend/src/lib/trace.ts`, `frontend/src/lib/api.ts`, `frontend/src/test/lib/trace.test.ts`.
- Rationale: end-to-end traces (browser → gateway → service → DB) require a propagated W3C context. Bundling the full OpenTelemetry browser SDK would add ~80 KB for a 50-line need. The backend already extracts and continues the context through `AddPlanoraTelemetry`'s AspNetCore instrumentation; the browser side only needs to emit a valid header.

## API Contract

**INV-API-3.** Every HTTP service wires Swagger / OpenAPI through the single shared `PlanoraSwaggerExtensions.AddPlanoraSwaggerGen(title, description)` extension. Services do not call `services.AddSwaggerGen()` directly. The Swagger UI middleware mounts only when the environment is `Development` or `Staging` (`UsePlanoraSwagger`); production never exposes the interactive UI. The OpenAPI document for each service is extracted offline in CI via `dotnet swagger tofile` and attached to every PR that touches a controller, DTO, BuildingBlocks, GrpcContracts, or `Directory.Packages.props`.

- Evidence: `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Configuration/PlanoraSwaggerExtensions.cs`, every service `Program.cs`, `.github/workflows/openapi.yml`, `.config/dotnet-tools.json`.
- Rationale: one Swagger registration surface, one CI artifact contract, one place to evolve the schema-id and security-scheme conventions before the eventual generated TypeScript client lands (Phase 2 T2.2). The dev/staging gate keeps the interactive UI off the production attack surface.

**INV-API-4.** Every extracted `openapi/<service>.json` artifact is linted by Spectral in CI with `--fail-severity=error`. The configuration lives at `.spectral.yaml` (extends `spectral:oas`) and treats contract-stability rules (`oas3-schema`, `operation-success-response`, `path-keys-no-trailing-slash`, `oas3-valid-media-example`, `oas3-valid-schema-example`, `operation-operationId-unique`, `operation-operationId-valid-in-url`) as errors. Documentation-friendliness rules (`info-description`, `operation-description`, `tag-description`, `oas3-parameter-description`) are downgraded to `hint` until the controller XML doc coverage is complete. Schema ids are sanitised by `PlanoraSwaggerExtensions.SanitizeSchemaId` so closed-generic CLR FullNames produce URI-reference-safe `$ref` fragments that Spectral's `oas3-schema` accepts.

- Evidence: `.spectral.yaml`, `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Configuration/PlanoraSwaggerExtensions.cs` (`SanitizeSchemaId`), `.github/workflows/openapi.yml` "Lint with Spectral" step, `tests/Planora.UnitTests/Services/Infrastructure/PlanoraSwaggerSchemaIdTests.cs`.
- Rationale: the OpenAPI artifact is a public contract once a TS client is generated from it. Spectral catches breaking-change classes (missing 2xx response, schemas with no valid example, paths with trailing slashes, duplicate or URL-illegal operation ids) before they reach a consuming client. The sanitised schema ids guarantee every artifact passes `oas3-schema` regardless of how exotic the CLR generic-type tree becomes.

- Evidence: `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Observability/PlanoraMetrics.cs`.
- Currently published: `planora.csrf.rejections{reason}`, `planora.grpc.unauthenticated{reason}`, `planora.outbox.messages{outcome}`, `planora.outbox.batch.duration` (histogram, seconds), `planora.outbox.message.age` (histogram, seconds).
- Rationale: one meter = one configuration knob in `AddMeter("Planora.*")` (already wildcard-subscribed by `AddPlanoraTelemetry`), one place to audit cardinality before shipping to a metrics backend that bills per series.

---

## CI Quality Gates

**INV-CI-1.** `dotnet build -warnaserror` and `npm run lint` + `npm run type-check` must be green on every PR. `Directory.Build.props` sets `TreatWarningsAsErrors=true` for backend.

**INV-CI-2.** `dotnet test` (unit + integration + ErrorHandling tests) and `npm run test:coverage` must be green on every PR.

**INV-CI-3.** Security pipeline runs on every PR and weekly schedule: gitleaks, `dotnet list package --vulnerable`, `npm audit --audit-level=moderate`, CodeQL SAST (csharp + javascript-typescript), Trivy IaC. A new HIGH or CRITICAL finding must be triaged before merge.

**INV-CI-4.** E2E pipeline (`docker compose up` + Playwright) must pass for any PR that touches `BuildingBlocks/**`, `GrpcContracts/**`, `Planora.ApiGateway/**`, `Services/**`, `frontend/**`, `docker-compose.yml`, or `postgres/**`.

---

## Workflow & Commit Hygiene

**INV-FLOW-1.** Migrations are committed alongside the schema change that produced them. A schema change is never merged without its EF migration.

**INV-FLOW-4.** Production migrations are applied by the dedicated `Planora.Migrator` CLI (`tools/Planora.Migrator/`), not by services calling `Database.MigrateAsync()` at startup. The migrator runs as a one-shot init step before service rollout — never simultaneously with the running service — so two replicas cannot race the migration history. The `.github/workflows/migrations.yml` workflow attaches an idempotent SQL script artifact (`dotnet ef migrations script --idempotent`) to every PR whose schema-relevant paths change; reviewers see exactly what will execute. The same workflow asserts every non-empty generated script carries `IF [NOT] EXISTS` markers — guarding against a future EF-tooling regression where `--idempotent` silently produces non-idempotent SQL.

- Evidence: `tools/Planora.Migrator/Program.cs`, `.github/workflows/migrations.yml`, `deploy/fly/migrator.fly.toml`.
- Rationale: EF Core's `Database.MigrateAsync` at app startup is a footgun in HA: two replicas booting the same schema change at once corrupt `__EFMigrationsHistory`. Idempotent script + one-shot runner removes the race and makes the migration auditable.

**INV-FLOW-5.** `Planora.Migrator` rejects schema drift. Before applying pending migrations for any service, the migrator enumerates the database's `__EFMigrationsHistory` (`GetAppliedMigrationsAsync`) and compares it to the migrations present in the compiled assembly (`Database.GetMigrations()`). Any applied migration that is not in the code set is treated as drift; the migrator logs an error, returns a non-zero exit code, and refuses to apply anything for that service. Operators must reconcile (restore the missing migration files in code, or reset the target environment) before re-running.

- Evidence: `tools/Planora.Migrator/Program.cs::RunForServiceAsync`.
- Rationale: a developer who deletes a migration file locally, or a deploy that targets a database advanced past the current code's known migration set, leaves `__EFMigrationsHistory` in an unrecognisable state. Partially applying additional migrations on top of that history corrupts the chain. Failing fast with a clear message is the only safe path.

**INV-FLOW-2.** Runtime user uploads (`Services/AuthApi/Planora.Auth.Api/wwwroot/avatars/`) and other generated content are gitignored. They never appear in `git status` of a clean working tree.

**INV-FLOW-3.** Conventional commits: `feat / fix / docs / style / refactor / perf / test / chore / ci / build`. Each commit ships one logical unit, with docs updated as part of the same commit when behavior or contracts changed.

---

## What this file is not

- This is not a style guide. Style lives in `.editorconfig`.
- This is not a roadmap. Future work lives in `docs/ROADMAP.md` and the off-repo master plan owned by the maintainer.
- This is not aspirational. Every rule above is currently observable in code, configuration, or CI.

When Phase 2 closes the API-response and Realtime-persistence gaps, the corresponding caveats above are removed and the rule is tightened.
