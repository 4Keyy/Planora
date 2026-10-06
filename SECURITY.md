# Security Policy

This file is the public security policy for Planora. The full implementation reference is [`docs/auth-security.md`](docs/auth-security.md), and production secret handling is documented in [`docs/secrets-management.md`](docs/secrets-management.md).

## Supported Versions

| Version / branch | Supported |
|---|---|
| `main` | yes |
| Released tags | not confirmed in the repository |
| Older branches | not confirmed in the repository |

No release support matrix was found in the repository. Until releases are formalized, security fixes should target `main`.

## Reporting A Vulnerability

Use GitHub Private Vulnerability Reporting for this repository.

Maintainer action required: enable it in GitHub under repository settings before publishing this project as an open-source repository. No project-specific security email address was found in the codebase or existing docs, so this policy does not invent one.

Do not open a public issue for exploitable vulnerabilities. Include:

- affected commit, branch, or version;
- exact reproduction steps;
- expected and actual behavior;
- impact assessment;
- logs, request examples, or screenshots when safe to share;
- whether the issue is already public or actively exploited.

## Response Expectations

| Step | Target |
|---|---|
| Initial acknowledgement | 3 business days |
| Triage and severity assessment | 7 business days |
| Fix plan for confirmed high/critical issues | 14 business days |
| Public disclosure | after a fix or mitigation is available |

These targets are policy goals, not automated guarantees in the current repository.

## Confirmed Security Model

- Access tokens are JWTs and are kept in frontend memory.
- Refresh tokens are stored as httpOnly `refresh_token` cookies scoped to `/auth/api/v1/auth`.
- Register/login/refresh responses do not return the raw refresh token in JSON.
- Auth, Todo, Category, Messaging and Collaboration require a double-submit CSRF token on HTTP mutations, including bearer-authenticated calls; Realtime and the gateway do not register that middleware.
- Protected services validate JWT issuer, audience, lifetime, and signing key locally.
- Admin-only endpoints use `[Authorize(Roles = "Admin")]`.
- Registration checks password length/complexity; change/reset additionally check weak patterns and optional HIBP; previous-password history is enforced on change-password only.
- APIs and gateway use shared `SecurityHeadersMiddleware`; Auth avatar static files run before it and set their own cache/nosniff headers.
- A global rate limiter defaults to 100/minute/partition; Auth operations have stricter policies and CSRF GET opts out at the service. Pipelines run limiting before authentication, so the normal partition is IP. Gateway adds independent global/auth IP windows.
- SignalR `NotificationHub` validates subscription topics against a static allowlist before granting group membership.
- Production CORS uses configured origins with credentials; gateway Development additionally permits loopback/private IPv4 origins.
- All inter-service gRPC calls are authenticated by a shared `x-service-key` metadata header; the `ServiceKeyServerInterceptor` rejects calls under `Unauthenticated` and emits the `planora.grpc.unauthenticated{reason}` counter with a low-cardinality reason tag (`missing_key`, `short_key`, `mismatch`) so credential-compromise activity is observable in real time.
- The CSRF middleware emits `planora.csrf.rejections{reason}` (`missing_header`, `missing_cookie`, `mismatch`) so anomalous rejection patterns are dashboardable.
- Centralized OpenTelemetry pipeline (see [`docs/configuration.md`](docs/configuration.md) "OpenTelemetry (Observability)" section) — traces and metrics are produced in every service via `AddPlanoraTelemetry`; the OTLP gRPC exporter activates only when `OTEL_EXPORTER_OTLP_ENDPOINT` (or `OpenTelemetry:OtlpEndpoint`) is set.

Key code:

- `Services/AuthApi/Planora.Auth.Api/Controllers/AuthenticationController.cs`
- `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Middleware/CsrfProtectionMiddleware.cs`
- `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Grpc/ServiceKeyServerInterceptor.cs`
- `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Observability/PlanoraMetrics.cs`
- `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Logging/TelemetryConfiguration.cs`
- `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Extensions/JwtAuthenticationExtensions.cs`
- `Services/AuthApi/Planora.Auth.Infrastructure/Services/Authentication/PasswordValidator.cs`
- `frontend/src/store/auth.ts`
- `frontend/src/lib/csrf.ts`
- `frontend/next.config.js`

## Required Secret Hygiene

Never commit `.env`. At minimum, set strong local/production values for:

- `POSTGRES_PASSWORD`
- `REDIS_PASSWORD`
- `RABBITMQ_USER`
- `RABBITMQ_PASSWORD`
- `JWT_SECRET`
- `GRPC_SERVICE_KEY` / `GrpcSettings__ServiceKey` on internal gRPC clients/servers

`JWT_SECRET` must be at least 32 characters and identical across the gateway and every backend service.

## Secret Scanning

`.github/workflows/security.yml` runs Gitleaks on pushes to `main`, `develop`, `audit/**` and `fix/**`, pull requests targeting `main`/`develop`, and the weekly scheduled run, with the upstream default ruleset extended by [`.gitleaks.toml`](.gitleaks.toml). The Planora-specific rules detect inlined values for `JwtSettings__Secret` / `JWT_SECRET`, `GRPC_SERVICE_KEY` / `GrpcSettings__ServiceKey`, Postgres / Redis connection-string passwords, `RABBITMQ_PASSWORD`, `Email__Password`, and generic high-entropy `SECRET` / `TOKEN` / `KEY` assignments. The allowlist explicitly excludes environment-variable interpolation forms (`${VAR:?...}`, `%VAR%`) so the docker-compose strict-required pattern does not trigger false positives.

## Software Bill Of Materials (SBOM)

`.github/workflows/security.yml` includes a CycloneDX SBOM job that emits a per-project SBOM for the .NET solution (`dotnet CycloneDX`, excluding test projects) and a single SBOM for the frontend npm tree (`@cyclonedx/cyclonedx-npm`). SBOMs are uploaded as an artifact with 90-day retention for runs covered by that workflow. They describe dependency inventory, not proof that all vulnerable paths are reachable or absent.

## Production Security Notes

The repository now includes a production baseline ([`docs/production.md`](docs/production.md)), Fly.io deployment manifests ([`deploy/fly/`](deploy/fly/) and [`deploy/fly/README.md`](deploy/fly/README.md)), and a one-shot migration runner ([`tools/Planora.Migrator/`](tools/Planora.Migrator/)), and [the CD workflow](.github/workflows/cd.yml) is committed. The audit found routing, listener and secret gaps in the Fly baseline; treat it as configuration to validate, not proof of a successful production deployment. Before production use, define:

- HTTPS termination and forwarded header policy;
- secure cookie behavior behind the proxy;
- secret management outside plaintext `.env` files;
- network isolation for PostgreSQL, Redis, and RabbitMQ;
- RabbitMQ AMQP binding/firewalling;
- backup/restore of service databases and Auth Data Protection keys, plus the CD migrator execution/rollback policy;
- observability sinks (set `OTEL_EXPORTER_OTLP_ENDPOINT` on every Fly app to activate trace + metric export) and alerting.

References:

- [`docs/production.md`](docs/production.md)
- [`docs/secrets-management.md`](docs/secrets-management.md)
- [`deploy/fly/README.md`](deploy/fly/README.md)
- [`.env.production.example`](.env.production.example)

## Audit Findings And Scope

The [2026-10-06 repository audit](docs/audits/2026-10-06.md) and
[authorization coverage map](docs/security-idor-coverage.md#known-findings-and-missing-regressions)
record concrete implementation gaps. In particular, public-task join bypasses the normal
friend gate/redaction, revoked subtask creators retain mutation paths, and comment deletion
does not recheck current branch access. These are findings, not fixed behavior.

Security-stamp checks fail open on Redis errors and use a fixed 120-minute retention;
existing SignalR connections are not continuously revalidated. Dependency scans also
report vulnerable package versions. Scanner results, source inspection and unit tests
provide different evidence; none is a guarantee of deployment security or a substitute
for resolving confirmed findings. No application behavior was changed by this documentation audit.
