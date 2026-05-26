# Secret Management

Planora depends on a small set of high-impact secrets. This guide defines how they should be generated, stored, rotated, and documented.

## Secret Inventory

| Secret / key | Required | Used by | Purpose | Confirmed source |
|---|---:|---|---|---|
| `POSTGRES_PASSWORD` | yes | PostgreSQL and backend connection strings | protects service databases | `docker-compose.yml` |
| `REDIS_PASSWORD` | yes | Redis and service Redis connection strings | protects cache/session infrastructure | `docker-compose.yml` |
| `RABBITMQ_USER` | yes | RabbitMQ and services | broker username | `docker-compose.yml` |
| `RABBITMQ_PASSWORD` | yes | RabbitMQ and services | broker password | `docker-compose.yml` |
| `JWT_SECRET` / `JwtSettings__Secret` | yes | gateway and all backend services | signs and validates JWT access tokens | `docker-compose.yml`, `ConfigurationValidator.cs` |
| PostgreSQL connection strings | production-specific | Auth, Todo, Category, Messaging | direct DB connectivity outside Compose | service `Program.cs` + appsettings |
| `Frontend__BaseUrl` | production-specific | Auth registration/password flows | frontend links for email verification/reset | `FrontendLinkBuilder.cs` |
| `Email__Password` | only when SMTP email is enabled | Auth email delivery | Gmail App Password or SMTP password | `EmailOptions.cs`, `SmtpEmailMessageSender.cs` |
| `Email__Username` | only when SMTP email is enabled | Auth email delivery | Gmail/SMTP account username | `EmailOptions.cs`, `SmtpEmailMessageSender.cs` |
| `Cors__AllowedOrigins__*` | production-specific | ASP.NET CORS policy | browser origin allow-list | service configuration |
| `GRPC_SERVICE_KEY` / `GrpcSettings__ServiceKey` | yes | every gRPC server + client (Auth, Todo, Category, Messaging, Realtime, Gateway) | symmetric shared secret validating the `x-service-key` metadata header on every internal gRPC call | `docker-compose.yml`, `ServiceKey*Interceptor.cs` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | optional | every backend service + Gateway | OTLP gRPC endpoint for trace + metric export; when unset, the OpenTelemetry pipeline is a silent no-op | `TelemetryConfiguration.cs`, `docs/configuration.md` |
| `OTEL_EXPORTER_OTLP_HEADERS` | optional | every backend service + Gateway | headers (e.g. `Authorization=Basic ...`) required by the OTLP backend (Grafana Cloud, observability vendors) | standard OpenTelemetry env var |
| `LOKI_URL` | optional | every backend service + Gateway | Grafana Loki push endpoint; when unset, the Serilog Loki sink is a silent no-op | `SerilogConfiguration.cs`, `docs/observability.md` |
| `LOKI_USER` | optional | every backend service + Gateway | basic-auth user for Loki (Grafana Cloud tenant id) | `SerilogConfiguration.cs` |
| `LOKI_TOKEN` | optional | every backend service + Gateway | basic-auth password for Loki (Grafana Cloud instance API token with `logs:write` scope) | `SerilogConfiguration.cs` |
| `FLY_API_TOKEN` | required for CD | GitHub Actions only — repository secret | authenticates `flyctl` in `.github/workflows/cd.yml` against the Fly.io org | `cd.yml`, `flyctl auth token` |

Gmail SMTP is supported through the Auth API email service. `Email__Password` must be a Google App Password when `Email__Provider=GmailSmtp`; do not store a normal Google account password in project files.

## Storage Rules

- Local development: copy `.env.example` to `.env`; never commit `.env`.
- Production: store secrets in the platform secret manager or CI/CD secret store.
- CI e2e: `.github/workflows/e2e.yml` generates temporary secrets at runtime and writes them to `.env.e2e`.
- Documentation templates: `.env.example` and `.env.production.example` must contain placeholders only.
- Pull requests must not include real values, connection strings with real passwords, private keys, tokens, or production domains that imply access credentials.

## Generation Guidance

Use cryptographically random values:

```bash
openssl rand -base64 48    # JWT_SECRET
openssl rand -hex 24       # POSTGRES_PASSWORD / REDIS_PASSWORD / RABBITMQ_PASSWORD
```

PowerShell alternative:

```powershell
[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(48))
```

`JWT_SECRET` must be at least 32 characters because `ConfigurationValidator.ValidateJwtSettings` rejects shorter secrets.

## Rotation Guidance

| Secret | Rotation approach |
|---|---|
| `JWT_SECRET` | Coordinate across all services. Rotating immediately invalidates existing access tokens. Prefer a planned maintenance window unless key rollover support is added. |
| `POSTGRES_PASSWORD` | Create/update database user credentials, update all service connection strings, restart services, verify schema initialization and health. |
| `REDIS_PASSWORD` | Update Redis `requirepass`, update every Redis connection string, restart dependent services. |
| `RABBITMQ_PASSWORD` | Update broker user password, update all services, restart workers/subscribers, verify queues and connection logs. |
| `Frontend__BaseUrl` / CORS origins | Update configuration and verify registration, password reset, login, and browser API calls. |
| `Email__Password` | Revoke the old Google App Password or SMTP credential, create a replacement, update the secret store, restart Auth API, and send a test verification email. |
| `GRPC_SERVICE_KEY` | Rotate across **every** service simultaneously — the symmetric shared-secret model has no per-service identity yet, so any drift between server and client values breaks the backplane. Generate a new value (≥32 characters), update every Fly app / docker-compose env, restart in dependency order (Auth → Category → Todo → Messaging → Realtime → Gateway). Watch the `planora.grpc.unauthenticated` metric — a non-zero `mismatch` rate during rotation indicates one service did not pick up the new value. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` / `OTEL_EXPORTER_OTLP_HEADERS` | Update on every app simultaneously to avoid a partial export window. The OTel pipeline reads the values at startup; restart the apps to pick up new endpoints. Setting the endpoint for the first time activates trace + metric export without a code change. |
| `LOKI_URL` / `LOKI_USER` / `LOKI_TOKEN` | Update across every app simultaneously, then `flyctl machine restart` each app so the Serilog Loki sink is re-registered with the new URL/credentials. Setting the URL for the first time activates centralized log shipping without a code change. |
| `FLY_API_TOKEN` (GitHub repository secret) | Generate a fresh token with `flyctl auth token`, set it via `flyctl auth token \| gh secret set FLY_API_TOKEN`, then revoke the previous token in the Fly dashboard. The CD workflow picks up the new value on the next invocation. |

## GitHub Actions Secrets

Current CI does not require long-lived repository secrets:

- `.github/workflows/ci.yml` builds/tests only.
- `.github/workflows/security.yml` runs static/dependency checks.
- `.github/workflows/e2e.yml` generates temporary Docker secrets for the test run.

If future deployment workflows are added, store registry credentials, cloud credentials, and production environment values as GitHub environment secrets with required reviewers.

## Leak Response

If a secret is committed or exposed:

1. Revoke or rotate it immediately in the backing system.
2. Remove it from current branch history before merging.
3. Audit logs for unauthorized use.
4. Add or update detection patterns if the leak type was not caught.
5. Document the incident in the private security channel, not a public issue, if exploitability is possible.

## Related Files

- `.env.example`
- `.env.production.example`
- `docker-compose.yml`
- `.github/workflows/e2e.yml`
- `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Configuration/ConfigurationValidator.cs`
- `Services/AuthApi/Planora.Auth.Application/Common/Security/FrontendLinkBuilder.cs`
