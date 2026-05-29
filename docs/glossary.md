# Glossary

| Term | Meaning | Where used |
|---|---|---|
| Access token | Short-lived JWT used in `Authorization: Bearer` headers | `AuthenticationController.cs`, `frontend/src/store/auth.ts` |
| API Gateway | Ocelot ingress service that maps public routes to backend services | `Planora.ApiGateway` |
| Auth API | Service that owns identity, sessions, friendships, roles, analytics intake | `Services/AuthApi` |
| CSRF | Cross-site request forgery protection using double-submit cookie/header | `CsrfProtectionMiddleware.cs`, `frontend/src/lib/csrf.ts` |
| Category | User-owned label for todos with color/icon/order | `Services/CategoryApi` |
| Category gRPC | Internal service contract used to validate/enrich todo categories | `GrpcContracts/Protos/category.proto` |
| CQRS | Command/query separation through MediatR handlers | `*.Application/Features` |
| Friend request | Pending friendship relation between requester and addressee | `FriendshipsController.cs` |
| Friendship | Accepted social relation used for todo sharing | `Friendship.cs`, `auth.proto` |
| Hidden todo | Todo marked hidden globally for owner/private tasks or through viewer prefs for shared tasks | `TodoItem.Hidden`, `UserTodoViewPreference` |
| Hidden redaction | Server-side masking of hidden shared/public todo DTO fields | `HiddenTodoDtoFactory.cs` |
| Inbox | Integration event deduplication/receipt table pattern | `BuildingBlocks/.../Inbox` |
| JWT | JSON Web Token used as access token | `JwtAuthenticationExtensions.cs` |
| Ocelot | .NET API Gateway library used for route mapping | `Planora.ApiGateway/ocelot*.json` |
| Outbox | Integration event persistence pattern | `BuildingBlocks/.../Outbox` |
| PagedResult | Shared pagination response type | `BuildingBlocks/.../Pagination/PagedResult.cs` |
| Playwright e2e | Docker-backed test that exercises gateway/service auth, sharing, todo, and hidden flow | `frontend/e2e`, `.github/workflows/e2e.yml` |
| Production baseline | Documented deployment checklist and runtime assumptions, not an automated deploy target | `docs/production.md` |
| Refresh token | Long-lived server-side token delivered as httpOnly cookie | `RefreshToken.cs`, `AuthenticationController.cs` |
| Result | Shared success/failure return model | `BuildingBlocks/Planora.BuildingBlocks.Domain/Result.cs` |
| Schema bootstrap | Startup path that applies EF migrations when present or creates schema from the current EF model when migrations are absent | `DatabaseStartup.cs`, service `Program.cs` files |
| Secret store | Production location for sensitive values such as database passwords and JWT secret | `docs/secrets-management.md`, `.env.production.example` |
| SignalR | ASP.NET realtime transport used by Realtime API | `Services/RealtimeApi` |
| Todo share | Explicit row granting another user access to a todo | `TodoItemShare.cs` |
| Todo status | Backend task lifecycle enum: `Todo`, `InProgress`, `Done` | `Services/TodoApi/Planora.Todo.Domain/Enums` |
| UserTodoViewPreference | Per-viewer hidden/category state for a shared todo | `UserTodoViewPreference.cs` |
| XSRF-TOKEN | Readable CSRF cookie that frontend echoes in `X-CSRF-Token` | `AuthenticationController.GetCsrfToken` |
| ADR | Architecture Decision Record — closed-form record of a decision and its rejected alternatives | `docs/DECISIONS/000*.md` |
| BuildingBlocks | Shared kernel — domain primitives, CQRS abstractions, Result type, middleware, observability pipeline, outbox/inbox, gRPC interceptors | `BuildingBlocks/Planora.BuildingBlocks.*` |
| CD pipeline | Tag-driven Fly.io blue/green deployment workflow | `.github/workflows/cd.yml` |
| ConfigurationValidator | Startup-time check that rejects weak JWT secrets and missing gRPC keys before the host binds a port | `BuildingBlocks/.../Configuration/ConfigurationValidator.cs` |
| Cosign | Sigstore tool for keyless artifact signing; used by the SBOM attestation step in CI | `.github/workflows/security.yml` |
| CycloneDX SBOM | Software Bill of Materials artifact emitted per build, listing every NuGet and npm dependency | `.github/workflows/security.yml` `sbom` job |
| Dependabot | Automated dependency-update PRs for npm, nuget, github-actions, docker ecosystems | `.github/dependabot.yml` |
| Error budget | Allowed shortfall implied by an SLO; burning it pauses feature work in favour of reliability | [`docs/slo.md`](slo.md) |
| Fly.io | Chosen production hosting target | `deploy/fly/`, `.github/workflows/cd.yml` |
| `fly.toml` | Per-app Fly.io manifest declaring build context, env, health probes, concurrency, VM size | `deploy/fly/*.fly.toml` |
| FLY_API_TOKEN | GitHub repository secret authenticating `flyctl` in the CD workflow | `.github/workflows/cd.yml` |
| Grafana Cloud OTLP | Managed OTLP endpoint for traces and metrics; enabled by setting `OTEL_EXPORTER_OTLP_ENDPOINT` per app | [`docs/observability.md`](observability.md) |
| Grafana Loki | Log aggregation backend; enabled by setting `LOKI_URL` per app | `SerilogConfiguration.TryAddLokiSink` |
| INV-XYZ-N | Closed-form architectural invariant identifier | [`docs/INVARIANTS.md`](INVARIANTS.md) |
| k6 | JavaScript load-test scenario runner | `perf/k6/`, `.github/workflows/perf-smoke.yml` |
| OpenTelemetry (OTel) | Cross-cutting traces + metrics pipeline registered via `AddPlanoraTelemetry` | `BuildingBlocks/.../Logging/TelemetryConfiguration.cs` |
| OTLP | OpenTelemetry Protocol — gRPC transport for traces and metrics; exporter is registered only when `OTEL_EXPORTER_OTLP_ENDPOINT` is set | same |
| Planora.Migrator | One-shot CLI applying pending EF Core migrations before each service rollout | `tools/Planora.Migrator/` |
| PlanoraMetrics | Shared `Meter("Planora.BuildingBlocks")` publishing CSRF / gRPC / outbox instruments | `BuildingBlocks/.../Observability/PlanoraMetrics.cs` |
| Rate-limit partition key | `u:<sub>` for authenticated requests, `ip:<address>` for anonymous; ensures users behind a shared NAT do not share a bucket | `ServiceCollectionExtensions.PartitionKey` |
| RED metrics | Rate / Errors / Duration — the three signals captured by ASP.NET Core OTel instrumentation | [`docs/observability.md`](observability.md) "Querying" |
| SBOM | See **CycloneDX SBOM** | same |
| Security stamp | Per-user value rotated on password change; existing tokens are rejected after rotation | `Services/AuthApi/.../Security/SecurityStampService.cs` |
| SLI | Service Level Indicator — the concrete metric a SLO measures | [`docs/slo.md`](slo.md) |
| SLO | Service Level Objective — numeric target an SLI must satisfy over a rolling window | [`docs/slo.md`](slo.md) |
| Stryker.NET | Mutation testing tool; runs on security-critical helpers | `tests/`, `stryker-config.json`, `stryker-auth.json` |
| Trace context | W3C `traceparent` header carrying trace-id and span-id across the browser → backend boundary | `frontend/src/lib/trace.ts`, `AddPlanoraTelemetry` AspNetCore instrumentation |
| TryAddLokiSink | Helper that adds a Grafana Loki Serilog sink when `LOKI_URL` is configured, no-op otherwise | `BuildingBlocks/.../Logging/SerilogConfiguration.cs` |
| Verify-Phase1-Prereqs.ps1 | Read-only checker for flyctl auth, per-app secrets, build cleanliness, FLY_API_TOKEN | `scripts/Verify-Phase1-Prereqs.ps1` |
