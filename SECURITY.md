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
- Browser state-changing requests require a double-submit CSRF token.
- Protected services validate JWT issuer, audience, lifetime, and signing key locally.
- Admin-only endpoints use `[Authorize(Roles = "Admin")]`.
- Password validation includes length/complexity checks, weak-pattern checks, optional HIBP lookup, and password history checks.
- All services share a single `SecurityHeadersMiddleware` for consistent, strict security headers.
- A global rate limiter (100 req/min/IP) covers every endpoint; Auth endpoints have stricter named policies.
- SignalR `NotificationHub` validates subscription topics against a static allowlist before granting group membership.
- CORS uses explicit origins with credentials.
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

`JWT_SECRET` must be at least 32 characters and identical across the gateway and every backend service.

## Secret Scanning

`.github/workflows/security.yml` runs Gitleaks on every push and pull request, with the upstream default ruleset extended by [`.gitleaks.toml`](.gitleaks.toml). The Planora-specific rules detect inlined values for `JwtSettings__Secret` / `JWT_SECRET`, `GRPC_SERVICE_KEY` / `GrpcSettings__ServiceKey`, Postgres / Redis connection-string passwords, `RABBITMQ_PASSWORD`, `Email__Password`, and generic high-entropy `SECRET` / `TOKEN` / `KEY` assignments. The allowlist explicitly excludes environment-variable interpolation forms (`${VAR:?...}`, `%VAR%`) so the docker-compose strict-required pattern does not trigger false positives.

## Software Bill Of Materials (SBOM)

`.github/workflows/security.yml` includes a CycloneDX SBOM job that emits a per-project SBOM for the .NET solution (`dotnet CycloneDX`, excluding test projects) and a single SBOM for the frontend npm tree (`@cyclonedx/cyclonedx-npm`). SBOMs are uploaded as an artifact with 90-day retention so the supply-chain inventory of every commit on `main` is retrievable.

## Production Security Notes

The repository now includes a production baseline ([`docs/production.md`](docs/production.md)), Fly.io deployment manifests ([`deploy/fly/`](deploy/fly/) and [`deploy/fly/README.md`](deploy/fly/README.md)), and a one-shot migration runner ([`tools/Planora.Migrator/`](tools/Planora.Migrator/)), but the CD workflow that wires them together is not yet committed. Before production use, define:

- HTTPS termination and forwarded header policy;
- secure cookie behavior behind the proxy;
- secret management outside plaintext `.env` files;
- network isolation for PostgreSQL, Redis, and RabbitMQ;
- RabbitMQ AMQP binding/firewalling;
- backup/restore and migration policy (the migrator is the chosen runner; the CD pipeline that invokes it pre-deploy is pending);
- observability sinks (set `OTEL_EXPORTER_OTLP_ENDPOINT` on every Fly app to activate trace + metric export) and alerting.

References:

- [`docs/production.md`](docs/production.md)
- [`docs/secrets-management.md`](docs/secrets-management.md)
- [`deploy/fly/README.md`](deploy/fly/README.md)
- [`.env.production.example`](.env.production.example)
