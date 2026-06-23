# Planora Architectural Invariants

These are **closed-form rules** that hold across the system at all times. Violations are reverted, not negotiated. Each invariant carries the evidence and the enforcement plan.

This file is short by design. If a rule belongs here, it belongs forever. Conditional or temporary items belong in ADRs (`docs/DECISIONS/`) until they harden into invariants.

---

## Service Ownership

**INV-OWN-1.** Each domain owns its own PostgreSQL database. No service reads or writes another service's tables.

- Domain → DB mapping: Auth → `planora_auth_db`; Todo → `planora_todo`; Category → `planora_category`; Messaging → `planora_messaging`; Collaboration → `planora_collaboration` (task comment timeline). Realtime currently has no DB (CSP-6).
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

**INV-COMM-5.** Every service that holds an `OutboxMessages` table indexes the canonical polling predicate (`Status = 'Pending' OR (Status = 'Failed' AND NextRetryUtc <= NOW)`) with a partial composite index `(Status, NextRetryUtc, OccurredOnUtc) WHERE Status IN ('Pending', 'Failed')` named `ix_outbox_messages_active`. Excluding the terminal `Processed` and `DeadLettered` rows keeps the index small even when the table accumulates ahead of the cleanup sweep. Auth, Category, Messaging, and Realtime services all carry this index; the configurations live under each service's `Persistence/Configurations/OutboxMessageConfiguration.cs`.

---

## Authentication & Sessions

**INV-AUTH-1.** Access tokens live **only in frontend memory**. They are never persisted to `localStorage`, `sessionStorage`, or any cookie.

- Evidence: `frontend/src/store/auth.ts` (Zustand persist includes user metadata + expiry, not the raw token).

**INV-AUTH-2.** Refresh tokens live **only in an httpOnly + SameSite=Strict cookie**, scoped to `/auth/api/v1/auth`. The frontend cannot read them. They are never returned in response bodies.

- Evidence: `Services/AuthApi/Planora.Auth.Api/Controllers/AuthenticationController.cs`, ADR-0002.

**INV-AUTH-3.** State-changing browser requests to Auth API carry the double-submit CSRF token (`X-CSRF-Token` header + readable `XSRF-TOKEN` cookie). Validation is constant-time.

- Evidence: `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Middleware/CsrfProtectionMiddleware.cs`, ADR-0003, ADR-0005 (CSRF coverage is intentionally bounded to Auth API).

**INV-AUTH-4.** Every command that materially changes the security posture of an account rotates the user's security stamp, so any access token issued before the change is rejected on its next authenticated request. The list of *currently-shipped* rotation points:

- password change (`ChangePasswordCommandHandler`);
- password reset (`ResetPasswordCommandHandler`);
- email change confirmation (`ChangeEmailCommandHandler`);
- 2FA disable (`Disable2FACommandHandler`);
- revoke all sessions (`RevokeAllSessionsCommandHandler`);
- account soft-delete (`DeleteUserCommandHandler`);
- refresh-token reuse detection (`RefreshTokenCommandHandler`, see INV-AUTH-6).

**Forward-looking policy.** Any future command that mutates the security posture of an account MUST rotate the stamp. Concretely this covers (when implemented):

- **role assignment / revocation** — adding or removing a `UserRole` row;
- **admin force-logout** — an admin-initiated session revocation against a target user;
- **manual lock / suspend** issued by an operator;
- **email change** that bypasses the standard confirmation flow (admin override);
- any new command that changes the set of access claims, the set of permitted scopes, or the set of resources the user can reach.

Stamp rotation runs **only on successful execution** — a wrong-password attempt MUST NOT invalidate active sessions, otherwise an observer can DoS the user. Stamp rotation is NOT triggered on 2FA enable or 2FA confirm because enabling strengthens the account; invalidating live sessions there would be friction without security benefit. Stamp rotation is NOT triggered on profile updates (first name, last name, avatar) because the access-claim set is unchanged. Stamp rotation is NOT triggered on revoking a *single* refresh token (`RevokeSessionCommandHandler`) because the user chose that specific session — other sessions remain authorized.

Stamp rotation is meaningless unless **every** JWT-accepting service enforces the check on every authenticated request. All five services — Auth, Category, Todo, Messaging, Realtime — wire `SecurityStampValidator.IsTokenRevokedAsync` into `JwtBearerOptions.OnTokenValidated`. Auth API enforces this in `Planora.Auth.Infrastructure.DependencyInjection.AddJwtAuthentication`; consumer services use the shared `AddJwtAuthenticationForConsumer` or an equivalent inline hook. The coverage table lives in `docs/auth-security.md` § "Stamp enforcement coverage".

The forward-looking policy is enforced by `SecurityStampUsageContractTests` (Planora.UnitTests): any handler that injects `ISecurityStampService` must also invoke `SetStampAsync` somewhere in its body. The test is a source-file scan over `Services/AuthApi/Planora.Auth.Application/Features/**/Handlers/` so a future handler that forgets the rotation call (or drops it during refactoring) fails CI before merge.

- Evidence: `Services/AuthApi/Planora.Auth.Api/Filters/TokenBlacklistFilter.cs`, `Services/AuthApi/Planora.Auth.Infrastructure/Services/Security/SecurityStampService.cs`, `Services/AuthApi/Planora.Auth.Infrastructure/DependencyInjection.cs` (Auth's `AddJwtAuthentication`), the seven command handlers listed above, `tests/Planora.UnitTests/Services/AuthApi/Infrastructure/AuthJwtStampWiringTests.cs` which pins the Auth wiring, and `tests/Planora.UnitTests/Services/AuthApi/Infrastructure/SecurityStampUsageContractTests.cs` which pins the forward-looking policy. Regression tests under `tests/Planora.UnitTests/Services/AuthApi/Users/Handlers/` pin the stamp call for success paths and its absence for failure paths.

**INV-AUTH-5.** TOTP secrets are encrypted at rest with ASP.NET Core Data Protection, keys persisted to Redis under `Planora:Auth:DataProtection-Keys`, scoped to application name `Planora.Auth`. Recovery codes are hashed with PBKDF2 (HMAC-SHA512, 210,000 iterations) before storage, via the same `IPasswordHasher` used for passwords.

- Evidence: `Services/AuthApi/Planora.Auth.Infrastructure/Persistence/AuthDbContext.cs`, `Services/AuthApi/Planora.Auth.Infrastructure/DependencyInjection.cs`.

**INV-AUTH-6.** Refresh-token rotation enforces **reuse detection**. When `RefreshTokenCommandHandler` is presented with a refresh-token value that is already revoked with reason `"Replaced by new token"`, the entire refresh-token chain for that user is revoked (reason `"Reuse detected — chain invalidated"`) and the user's security stamp is rotated. Both effects are persisted in the same SaveChangesAsync call as the revocation. The handler returns Unauthorized; no new token is minted.

- Evidence: `Services/AuthApi/Planora.Auth.Application/Features/Authentication/Handlers/RefreshToken/RefreshTokenCommandHandler.cs`, `tests/Planora.UnitTests/Services/AuthApi/Authentication/Handlers/AuthLifecycleHandlerTests.cs::RefreshToken_WhenReplayed_InvalidatesChainAndRotatesStamp`.
- Rationale: a replayed rotated token is either a buggy client racing its own refresh or — much more likely — an attacker presenting a stolen value. Invalidating the chain logs the legitimate user out across all devices and, paired with stamp rotation, immediately retires every minted access token. The user must re-authenticate; the attacker is left holding revoked credentials.

**INV-AUTH-7.** Every JWT-validating wiring point reads `ClockSkew` from one source — `Planora.BuildingBlocks.Infrastructure.Configuration.SecurityConstants.SecurityPolicies.TokenClockSkewSeconds`. No service writes a literal `TimeSpan.Zero` or numeric seconds value into `TokenValidationParameters.ClockSkew`. The pinned tests at `tests/Planora.UnitTests/Services/AuthApi/Configuration/AuthApiConfigurationTests.cs` and `tests/Planora.UnitTests/Services/Infrastructure/DependencyInjectionContractTests.cs` assert the value matches the constant.

- Evidence: `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Configuration/SecurityConstants.cs`, every JWT bearer registration across Auth, Todo, Category, Messaging, Realtime, Gateway, and the standalone TokenService validation paths.
- Rationale: divergent clock-skew values across services produce intermittent 401s under NTP drift between machines. A single source eliminates the entire class of clock-skew regressions.

---

## Authorization & Privacy

**INV-AZ-1.** Every controller action that touches user-owned data is either `[Authorize]` or explicitly declared anonymous and reviewed. Anonymous endpoints are exhaustively listed in `docs/auth-security.md`. Anything not listed must be authorized.

**INV-AZ-2.** Admin-only endpoints carry `[Authorize(Roles = "Admin")]`. Role assignment happens in Auth DB seed only. Application code never grants `Admin` from request input.

**INV-AZ-3.** Hidden shared/public todos are **redacted server-side** via `HiddenTodoDtoFactory`. The frontend never receives sensitive content for a hidden todo. Visual fields (`Priority`, `IsPublic`, `HasSharedAudience`, `IsVisuallyUrgent`) are preserved for non-content frame rendering.

- Evidence: `Services/TodoApi/Planora.Todo.Application/Features/Todos/HiddenTodoDtoFactory.cs`, ADR-0004.

**INV-AZ-4.** Task comment threads require an accepted friendship between the viewer and the task owner (when the task is shared/public). The comment timeline is owned by the Collaboration service, which never reads Todo's database: it authorises every comment read/write through the `TodoService.CheckTaskCommentAccess` gRPC call, which applies the exact owner / shared / public + friendship rule. The friendship check therefore remains mandatory and centralised in TodoApi (INV-OWN-2/3).

- Evidence: commit `5a3a83e` — "require friendship to read todo comments"; `Services/TodoApi/Planora.Todo.Api/Grpc/TodoGrpcService.cs` (`CheckTaskCommentAccess`); `Services/CollaborationApi/Planora.Collaboration.Application/Features/Comments/**`.

**INV-AZ-5.** User-uploaded avatars are server-validated, re-encoded to WebP, and stripped of EXIF/ICC/XMP metadata before persistence. Raw bytes from `IFormFile` never reach disk. Only `image/jpeg`, `image/png`, `image/webp` are accepted, capped at 5 MB and 4096×4096; magic bytes are sniffed regardless of declared `Content-Type`. Storage is content-addressed under `/avatars/{userId}/{contentHash}/{size}.webp` and served with `Cache-Control: public, max-age=31536000, immutable`.

- Evidence: `Services/AuthApi/Planora.Auth.Application/Features/Users/Validators/UploadAvatar/UploadAvatarCommandValidator.cs`, `Services/AuthApi/Planora.Auth.Infrastructure/Services/Common/{ImageSharpImageProcessor,LocalAvatarStorage}.cs`, `Services/AuthApi/Planora.Auth.Api/Program.cs`, `docs/auth-security.md` § Avatar File Pipeline.

**INV-AZ-6.** The gRPC client interceptor (`ServiceKeyClientInterceptor`) emits exactly one outbound credential — `x-service-key`. It never propagates the inbound HTTP `Authorization` (Bearer JWT) header or any cookie into outgoing gRPC metadata. Trust contexts are kept fully separate: the inbound HTTP request authenticates the *user*, the outbound gRPC call authenticates the *peer service*. Pinned by `ServiceKeyInterceptorTests.ClientInterceptor_DoesNotLeakAuthorizationHeaderIntoOutgoingMetadata`.

- Evidence: `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Grpc/ServiceKeyClientInterceptor.cs`, `tests/Planora.UnitTests/BuildingBlocks/Grpc/ServiceKeyInterceptorTests.cs`.
- Rationale: confusing the two contexts would let a peer service mint forged identities by reusing the original user's JWT against a third service.

**INV-AZ-7.** The API Gateway processes `X-Forwarded-For` / `X-Forwarded-Proto` / `X-Forwarded-Host` **only when** `ForwardedHeaders:KnownProxies` is non-empty in configuration. With an empty list (the default), `UseForwardedHeaders` is never registered and external clients cannot spoof their IP into rate-limit partitioning or downstream logs.

**INV-AZ-8.** Every `[Authorize]` endpoint that takes a resource-identifier path parameter is enumerated in `docs/security-idor-coverage.md` with the IDOR protection mechanism (owner check, viewer filter, friend gate, role gate) and a pointer to the test or invariant that pins it. Reviewers MUST reject any PR that adds such an endpoint without (a) updating the coverage table and (b) shipping an explicit cross-user test.

- Evidence: `Planora.ApiGateway/Program.cs` — the conditional `Configure<ForwardedHeadersOptions>` + `app.UseForwardedHeaders()` block guarded by `knownProxies.Length > 0`.
- Rationale: trusting forwarded headers unconditionally creates a rate-limit bypass (`X-Forwarded-For: <victim-ip>`). Production deployments behind Fly must configure the Fly edge range explicitly.

---

## Data Integrity

**INV-DATA-1.** Every domain mutation goes through an aggregate root method. Setters on entities are not used to mutate state from application code. Validation lives in domain methods + FluentValidation validators.

**INV-DATA-2.** EF Core `SaveChangesAsync` is the only commit primitive. Multi-table mutations within a service happen in a single transaction. The outbox row is in the same transaction as the business mutation.

**INV-DATA-3.** Read-only queries use `.AsNoTracking()`. Mutating workflows do not.

**INV-DATA-4.** Soft-deleted rows are filtered by global query filters. Admin/audit paths that need to see deleted rows must call `.IgnoreQueryFilters()` explicitly and document the reason in code.

**INV-DATA-5 (scaffold; behaviour follow-up pending).** The Realtime persistence contract is defined: every `NotificationEvent` consumed from RabbitMQ lands in `Planora.Realtime.Domain.Entities.Notification` before fan-out to SignalR; per-recipient delivery state is tracked in `NotificationDelivery` with `Pending → Delivered | NotConnected | Failed`; deduplicated by `SourceEventId` (unique index) so transient redeliveries from the broker never insert twice. The domain entities, the `RealtimeDbContext`, the EF configurations, the migrator registration, and the conditional DI are in place. The `NotificationService` rewire (persist-before-push, idempotent on replay) and the initial EF migration ship next; until then `NotificationService` bypasses persistence and the scaffold is dormant — connection-string-aware activation means dev hosts without `ConnectionStrings__RealtimeDatabase` start clean.

---

## Configuration & Secrets

**INV-CFG-1.** Secrets never appear in `appsettings.json`, `appsettings.*.json` committed to git, code, comments, or test fixtures. Secrets come from environment variables in dev/CI and from a secret manager in production.

- Tooling: gitleaks runs in `.github/workflows/security.yml` with Planora-specific rules in `.gitleaks.toml`.

**INV-CFG-2.** Docker-compose required secrets use the strict form `${VAR:?VAR env var must be set}`. Stack does not start with a missing required secret.

- Evidence: `docker-compose.yml`.

**INV-CFG-3.** `GRPC_SERVICE_KEY` and `JwtSettings__Secret` are validated at service startup by `ConfigurationValidator` (minimum 16 chars for service key, minimum 32 chars for JWT secret). Failure aborts startup, never falls back to a default.

---

## API Surface

**INV-API-1.** Error responses follow `ApiResponse<object>.Failed(...)` shape produced by `EnhancedGlobalExceptionMiddleware`. New controllers must not throw raw `Exception` to client — they let middleware translate it.

**INV-API-2.** Success responses currently take one of three shapes (`Result<T>`, `PagedResult<T>` wrapper, or raw DTO). Frontend reads them through `parseApiResponse`. **New endpoints prefer raw DTO** to keep migration to RFC 7807 cheap. Do not introduce a fourth shape.

---

## Observability

**INV-OBS-1.** Every request gets a correlation id via `CorrelationIdMiddleware`. Every log line carries `CorrelationId`, `SpanId`, `OperationName`, `UserId` (when present), and `ServiceName` via Serilog enrichers.

**INV-OBS-2.** Auth-sensitive log lines never contain the bearer token, refresh token, password, TOTP code, or recovery code. Logging of `Authorization` headers in API Gateway is suppressed by configuration.

**INV-OBS-3.** Business events go through `IBusinessEventLogger`. They are structured logs, not free-form `_logger.LogInformation`.

**INV-OBS-4.** Every service exposes three health-probe endpoints: `/health/live` (process liveness, no external deps), `/health/ready` (dependencies reachable, ready to accept traffic), and `/health` (aggregate, retained for backwards-compatible consumers like docker-compose). Wiring is centralized in `MapPlanoraHealthEndpoints()`; services do not call `MapHealthChecks` directly. Liveness checks carry tag `live`, readiness checks carry tag `ready`.

- Evidence: `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Extensions/HealthCheckExtensions.cs`.
- Rationale: orchestrators (Fly.io machines, k8s) need distinct liveness vs readiness semantics; aggregate `/health` cannot distinguish "process is dead, restart me" from "I'm alive but Postgres is slow, don't route to me yet".

**INV-OBS-5.** Every backend service and the API Gateway wire OpenTelemetry through the single shared `TelemetryConfiguration.AddPlanoraTelemetry(...)` extension. Services do not call `services.AddOpenTelemetry()` directly **and do not introduce per-service wrappers** around `AddPlanoraTelemetry`. The pipeline is no-op when `OTEL_EXPORTER_OTLP_ENDPOINT` (or `OpenTelemetry:OtlpEndpoint`) is unset — no exporters, no background connections, no log noise — while still recording in-process traces and metrics so any future exporter can be added without code changes. Custom activity sources and meters published as `Planora.*` are auto-discovered. `/health*` paths are excluded from request tracing to suppress probe noise. EF Core SQL text capture (`SetDbStatementForText`) is **off by default** and opted in per environment via `OpenTelemetry:Tracing:CaptureDbStatementText=true` — keeping potential PII in parameter values out of trace exports unless the operator consciously enables it.

- Evidence: `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Logging/TelemetryConfiguration.cs`, every service `Program.cs` (each calls `builder.Services.AddPlanoraTelemetry(...)` directly).
- Rationale: a single instrumentation surface means one place to add new instrumentations (gRPC client, RabbitMQ, SignalR), one place to configure sampling and resource attributes, and one place to flip exporters between vendors. Wrapper helpers around the canonical call invariably drift, so they are explicitly forbidden.

**INV-OBS-6.** Custom Planora metrics are published through one shared `Meter` named `Planora.BuildingBlocks` defined in `BuildingBlocks.Infrastructure.Observability.PlanoraMetrics`. Services do not create their own `Meter` instances for cross-cutting concerns. New instruments follow OpenTelemetry semantic conventions: explicit units (`s`, `{rejection}`, `{message}`), low-cardinality tag values from a finite enumeration, and `_total` is implicit (added by the Prometheus exporter, not the instrument name).

- Evidence: `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Observability/PlanoraMetrics.cs`.
- Currently published: `planora.csrf.rejections{reason}`, `planora.grpc.unauthenticated{reason}`, `planora.outbox.messages{outcome}`, `planora.outbox.batch.duration` (histogram, seconds), `planora.outbox.message.age` (histogram, seconds), `planora.avatar.uploads{outcome}`, `planora.avatar.variant.bytes{size}` (histogram, bytes), `planora.cache.operations{prefix,outcome}`.
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
- Rationale: one Swagger registration surface, one CI artifact contract, one place to evolve the schema-id and security-scheme conventions before any generated TypeScript client lands. The dev/staging gate keeps the interactive UI off the production attack surface.

**INV-API-4.** Every extracted `openapi/<service>.json` artifact is linted by Spectral in CI with `--fail-severity=error`. The configuration lives at `.spectral.yaml` (extends `spectral:oas`) and treats contract-stability rules (`oas3-schema`, `operation-success-response`, `path-keys-no-trailing-slash`, `oas3-valid-media-example`, `oas3-valid-schema-example`, `operation-operationId-unique`, `operation-operationId-valid-in-url`) as errors. Documentation-friendliness rules (`info-description`, `operation-description`, `tag-description`, `oas3-parameter-description`) are downgraded to `hint` until the controller XML doc coverage is complete. Schema ids are sanitised by `PlanoraSwaggerExtensions.SanitizeSchemaId` so closed-generic CLR FullNames produce URI-reference-safe `$ref` fragments that Spectral's `oas3-schema` accepts.

- Evidence: `.spectral.yaml`, `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Configuration/PlanoraSwaggerExtensions.cs` (`SanitizeSchemaId`), `.github/workflows/openapi.yml` "Lint with Spectral" step, `tests/Planora.UnitTests/Services/Infrastructure/PlanoraSwaggerSchemaIdTests.cs`.
- Rationale: the OpenAPI artifact is a public contract once a TS client is generated from it. Spectral catches breaking-change classes (missing 2xx response, schemas with no valid example, paths with trailing slashes, duplicate or URL-illegal operation ids) before they reach a consuming client. The sanitised schema ids guarantee every artifact passes `oas3-schema` regardless of how exotic the CLR generic-type tree becomes.

---

## CI Quality Gates

**INV-CI-1.** `dotnet build -warnaserror` and `npm run lint` + `npm run type-check` must be green on every PR. `Directory.Build.props` sets `TreatWarningsAsErrors=true` for backend.

**INV-CI-2.** `dotnet test` (unit + integration + ErrorHandling tests) and `npm run test:coverage` must be green on every PR.

**INV-CI-3.** Security pipeline runs on every PR and weekly schedule: gitleaks, `dotnet list package --vulnerable`, `npm audit --audit-level=high`, CodeQL SAST (csharp + javascript-typescript), Trivy IaC (with a fail-on-HIGH/CRITICAL second pass). A new HIGH or CRITICAL finding must be triaged before merge.

**INV-CI-4.** E2E pipeline (`docker compose up` + Playwright) must pass for any PR that touches `BuildingBlocks/**`, `GrpcContracts/**`, `Planora.ApiGateway/**`, `Services/**`, `frontend/**`, `docker-compose.yml`, or `postgres/**`.

---

## Performance

**INV-PERF-1.** Integration tests guard against N+1 query regressions via the `N1SentinelInterceptor` from `BuildingBlocks.Infrastructure.Persistence`. New integration suites that exercise a request-scoped data path wrap the call under test in `using (N1SentinelInterceptor.BeginScope(threshold: …)) { … }`. A SQL fingerprint that executes more than the threshold within the scope throws `N1SentinelException` and fails the test. Outside an active scope the interceptor is a no-op and ships zero runtime cost in production. Legitimate repeats (e.g. an intentional foreach over related entities) opt out via a `whitelist` substring rather than by removing the scope.

- Evidence: `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Persistence/N1Sentinel.cs`, `tests/Planora.UnitTests/BuildingBlocks/Persistence/N1SentinelTests.cs`.
- Rationale: N+1 patterns are cheap to write, expensive to catch in code review, and only visible in production-load traces. A test-side interceptor closes the gap before the query reaches a real database.

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
- This is not a roadmap. Future work is tracked through ADRs in `docs/DECISIONS/`.
- This is not aspirational. Every rule above is currently observable in code, configuration, or CI. When a tightening lands (e.g. the API-response unification or the Realtime persistence behaviour rewire), the corresponding caveat is removed and the rule is restated.
