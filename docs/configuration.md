# Configuration

Planora configuration comes from environment variables, `appsettings*.json`, Docker Compose, Ocelot route files, Next.js config, and launch scripts.

## Configuration Sources

| Source | Purpose |
|---|---|
| `.env.example` | template for `.env`; documents required local secrets and defaults |
| `.env.production.example` | production-oriented key template; placeholders only, not a deployment secret file |
| `docker-compose.yml` | infrastructure, container ports, required secret interpolation, container env vars |
| `Planora.ApiGateway/ocelot.json` | local gateway route map |
| `Planora.ApiGateway/ocelot.Docker.json` | Docker gateway route map |
| `*/appsettings.json` | local service defaults |
| `*/appsettings.Docker.json` | Docker service defaults where present |
| `*/Properties/launchSettings.json` | developer launch profiles; some values are examples and are not the source of truth for Compose |
| `frontend/next.config.js` | frontend API base URL normalization and security headers |
| `frontend/src/lib/config.ts` | runtime API URL validation/fallback |
| `Start-Planora-*.ps1` | process orchestration and local env conversion |

## Required Docker Compose Variables

These are enforced with `${VAR:?message}` in `docker-compose.yml`.

| Variable | Required | Used by | Notes |
|---|---:|---|---|
| `POSTGRES_PASSWORD` | yes | `postgres`, backend DB connection strings | PostgreSQL is bound to `127.0.0.1:5433` on the host. |
| `REDIS_PASSWORD` | yes | `redis`, gateway/realtime Redis strings, backend Redis connection strings | Redis starts with `--requirepass`; service connection strings must include the same password. |
| `RABBITMQ_USER` | yes | RabbitMQ container and backend containers | Sets `RABBITMQ_DEFAULT_USER` and service credentials. |
| `RABBITMQ_PASSWORD` | yes | RabbitMQ container and backend containers | Sets `RABBITMQ_DEFAULT_PASS` and service credentials. |
| `JWT_SECRET` | yes | all backend services and gateway through `JwtSettings__Secret` | Must be at least 32 characters and identical for every service. |
| `GRPC_SERVICE_KEY` | yes | All inter-service gRPC channels (Auth, Todo, Category, Messaging, Realtime) | Authenticates internal gRPC channels via `x-service-key` metadata. Must be identical for every service; at least 16 characters is enforced, 32+ recommended. |

## OpenTelemetry (Observability)

Every backend service and the API Gateway are instrumented via the shared
`TelemetryConfiguration.AddPlanoraTelemetry(...)` extension in
`BuildingBlocks.Infrastructure.Logging`. Wiring is fully optional — if no
exporter endpoint is configured the pipeline is a no-op (no background
connection attempts, no log noise) while still recording in-process traces
and metrics that any future exporter can pick up.

| Variable / config key | Where read | Default | Meaning |
|---|---|---|---|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | environment variable, standard OTel | unset | OTLP gRPC endpoint (e.g. `http://otel-collector:4317` or Grafana Cloud OTLP URL). When unset, no exporter is registered. |
| `OpenTelemetry:OtlpEndpoint` | `appsettings.json` | unset | Same as `OTEL_EXPORTER_OTLP_ENDPOINT`; the env var wins if both are set. |
| `OpenTelemetry:ServiceName` | `appsettings.json` | per-service default (`AuthService`, `TodoService`, `CategoryService`, `MessagingService`, `RealtimeService`, `ApiGateway`) | Overrides the resource `service.name` attribute. |
| `OpenTelemetry:ServiceVersion` | `appsettings.json` | entry assembly version | Resource `service.version` attribute. |
| `OpenTelemetry:ConsoleExporter:Enabled` | `appsettings.json` | `false` | When `true`, writes spans and metrics to stdout — useful for local debugging only. |
| `OpenTelemetry:Tracing:Enabled` | `appsettings.json` | `true` | Kill switch for the entire tracing pipeline. |
| `OpenTelemetry:Metrics:Enabled` | `appsettings.json` | `true` | Kill switch for the entire metrics pipeline. |
| `OpenTelemetry:Tracing:CaptureDbStatementText` | `appsettings.json` | `true` | When `true`, EF Core SQL text is captured in span attributes. SQL may contain PII via parameter values; restrict trace-backend access accordingly, or set to `false` if the trace backend is not trusted with this data. |

The resource adds two static attributes: `deployment.environment` (from
`ASPNETCORE_ENVIRONMENT`) and `service.namespace=planora`. The
`service.instance.id` attribute is set to the container/machine hostname.

> **Production note.** Per-service `appsettings.Production.json` files are
> `.gitignore`d and are **not** part of the deployed image, so production
> deployments must supply the collector endpoint through the
> `OTEL_EXPORTER_OTLP_ENDPOINT` environment variable (a Fly secret / container
> env), not through `OpenTelemetry:OtlpEndpoint`. The `appsettings.json` config
> key exists for local/self-hosted runs that do commit a config file. The env
> var is the single source of truth for traces/metrics export in production.

## Centralized Logs (Grafana Loki)

`SerilogConfiguration.TryAddLokiSink` adds a Grafana Loki sink to every
service when a push URL is configured. Like the OTLP exporter, the sink
is **only registered when the URL is present** — there is no fallback
and no log noise when it is absent.

| Variable / config key | Where read | Default | Meaning |
|---|---|---|---|
| `LOKI_URL` | environment variable (preferred) | unset | Loki push endpoint, e.g. `https://logs-prod-eu-west-0.grafana.net/loki/api/v1/push`. |
| `Serilog:Loki:Url` | `appsettings.json` | unset | Same as `LOKI_URL`. |
| `LOKI_USER` | environment variable | unset | Basic-auth user. For Grafana Cloud, the tenant / user id from the OTLP page. |
| `Serilog:Loki:Credentials:Login` | `appsettings.json` | unset | Same. |
| `LOKI_TOKEN` | environment variable | unset | Basic-auth password (Grafana Cloud instance API token with `logs:write` scope). |
| `Serilog:Loki:Credentials:Password` | `appsettings.json` | unset | Same. |
| `Serilog:Loki:MinimumLevel` | `appsettings.json` | `Information` | Minimum log event level shipped to Loki. |

Labels emitted: `service_name`, `environment`. Per-request labels are
intentionally absent so a per-stream-billed backend is not overloaded.
The full operational walkthrough — Grafana Cloud setup, suggested alert
rules, log-to-trace correlation — lives in
[`observability.md`](observability.md).

`.env.production.example` documents the keys expected by a production deployment or secret store. It includes:

- public origins: `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_API_GATEWAY_URL`, `Frontend__BaseUrl`, `Cors__AllowedOrigins__0`;
- Compose-compatible secrets: `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `RABBITMQ_USER`, `RABBITMQ_PASSWORD`, `JWT_SECRET`;
- direct ASP.NET overrides for non-Compose deployments: `JwtSettings__Secret`, `GrpcSettings__ServiceKey`, `ConnectionStrings__*`, `RabbitMq__*`, `RabbitMQ__*`;
- email delivery settings: `Email__Provider`, `Email__Username`, `Email__Password`, SMTP host/port/TLS, sender identity;
- gRPC dependency URLs for Todo API: `GrpcServices__AuthApi`, `GrpcServices__CategoryApi`.

Use it as a checklist, not as a committed source of real values. See [`secrets-management.md`](secrets-management.md) and [`production.md`](production.md).

## Environment Variables In `.env.example`

| Variable | Status | Meaning |
|---|---|---|
| `POSTGRES_USER` | documented, not used by Compose as a variable | Compose hardcodes `POSTGRES_USER: postgres`. |
| `POSTGRES_PASSWORD` | required | PostgreSQL superuser password and all service DB passwords in Compose. |
| `POSTGRES_DB` | optional/documented | Default database for PostgreSQL init; individual services use their own databases. |
| `JWT_SECRET` | required | Maps to `JwtSettings__Secret` in Compose. |
| `JWT_ISSUER` | informational in `.env.example` | Compose injects fixed `JwtSettings__Issuer: Planora.Auth`; services also default to this in appsettings. |
| `JWT_AUDIENCE` | informational in `.env.example` | Compose injects fixed `JwtSettings__Audience: Planora.Clients`; services also default to this in appsettings. |
| `JWT_ACCESS_TOKEN_EXPIRATION_MINUTES` | informational | Not directly injected by current Compose. Auth local appsettings uses 15 minutes; Docker auth appsettings/Compose context uses 60 minutes where configured. |
| `JWT_REFRESH_TOKEN_EXPIRATION_DAYS` | informational | Appsettings default is 7 days. |
| `RABBITMQ_USER` | required | RabbitMQ default user; Compose feeds it into every service's `RabbitMq__UserName`. |
| `RABBITMQ_PASSWORD` | required | RabbitMQ default password; Compose feeds it into every service's `RabbitMq__Password`. |
| `REDIS_PASSWORD` | required | Redis `requirepass`; Compose builds each service's `ConnectionStrings__Redis` from it. |
| `NEXT_PUBLIC_API_URL` | optional | Frontend API Gateway base URL; default is `http://localhost:5132`. |
| `NEXT_PUBLIC_API_GATEWAY_URL` | optional alias | Read by `frontend/next.config.js` if `NEXT_PUBLIC_API_URL` is absent. |
| `NEXT_PUBLIC_ENVIRONMENT` | optional | Environment label; no direct behavior found in core API client. |
| `HOST` | optional | Host binding for Next.js dev server when used by npm/launcher context. |
| `Frontend__BaseUrl` | optional | Frontend origin used in email verification/password-reset links. Use the laptop LAN IP instead of `localhost` when links are opened from another Wi-Fi device. |
| `Cors__AllowedOrigins__0`, `Cors__AllowedOrigins__1`, ... | optional | Explicit frontend origins for credentialed CORS. Add the LAN frontend origin when using another device. |
| `Email__Provider` | optional | Auth email delivery provider. `Log` writes links to logs; `GmailSmtp` sends real mail through Gmail SMTP; `Smtp` uses generic SMTP settings. |
| `Email__SmtpHost` / `Email__SmtpPort` / `Email__EnableSsl` | optional | SMTP connection settings. Gmail defaults are `smtp.gmail.com`, `587`, and TLS enabled. |
| `Email__Username` / `Email__Password` | required for SMTP providers | SMTP credentials. For Gmail, `Email__Password` must be a Google App Password, not the normal account password. |
| `Email__FromEmail` / `Email__FromName` | optional for SMTP providers | Sender address/display name. If `FromEmail` is empty, the service uses `Email__Username`. |
| `Email__TimeoutSeconds` | optional | SMTP send timeout. Default is 30 seconds. |
| `ASPNETCORE_ENVIRONMENT` | optional | ASP.NET environment; Compose sets `Docker` per backend container. |
| `ASPNETCORE_URLS` | optional | Kestrel URL override when explicitly provided. |
| `RateLimiting__Backend` | optional | Set to `Redis` to use the Redis-backed distributed rate limiter (required in multi-replica production so per-IP counters are shared); unset (default) uses the in-memory limiter. `docker-compose.yml` sets it for every service. |
| `Security__RequireHttps` | optional | Overrides the auth cookie `Secure` flag (config key `Security:RequireHttps`, read by `AuthenticationController`). Unset (default) keeps the secure default — `Secure` cookies in every non-Development environment. The `-Prod` local launcher sets it to `false` so a plain-HTTP LAN run still accepts the refresh/XSRF cookies; real deployments leave it unset and terminate TLS at the front door. |
| `CORS_ALLOWED_ORIGINS` | documented but no direct parser found | Services read `Cors:AllowedOrigins` from appsettings/configuration. For env override use ASP.NET nested configuration keys such as `Cors__AllowedOrigins__0`. |

## Service Ports

| Service | Local appsettings / Ocelot target | Docker host port | Notes |
|---|---:|---:|---|
| Frontend | `3000` | not in Compose | Next.js dev server. |
| API Gateway | `5132` | `5132 -> 80` | Browser default API base URL. |
| Auth API | Ocelot local target `5030` | `5031 -> 80` | Local appsettings also exposes an HTTP/2 endpoint at `5031`. Prefer gateway routes for API calls. |
| Todo API | `5100` | `5100 -> 80` | Todo gRPC is local `5101` in appsettings, but Compose routes service-to-service through container URLs. |
| Category REST | `5281` | `5281 -> 80` | REST endpoint used by gateway. |
| Category gRPC | `5282` | `5282 -> 81` | Todo uses `GrpcServices__CategoryApi=http://category-api:81` in Compose. |
| Messaging API | `5058` | `5058 -> 80` | Includes `/api/v1/messages/health`. |
| Realtime API | `5032` | `5032 -> 80` | SignalR hub path is `/hubs/notifications` inside the service; gateway exposes realtime through `/realtime/{everything}`. |
| PostgreSQL | container `5432` | `127.0.0.1:5433` | Local scripts convert Docker DB host/ports to localhost/5433. |
| Redis | `6379` | `127.0.0.1:6379` | Password required in Docker. |
| RabbitMQ AMQP | `5672` | `127.0.0.1:5672` | Local broker port. |
| RabbitMQ UI | `15672` | `127.0.0.1:15672` | Management UI. |

## JWT Configuration

Every protected service validates JWTs locally. The shared values are:

```json
{
  "JwtSettings": {
    "Secret": "",
    "Issuer": "Planora.Auth",
    "Audience": "Planora.Clients",
    "AccessTokenExpirationMinutes": 15,
    "RefreshTokenExpirationDays": 7
  }
}
```

Important details:

- `JwtSettings:Secret` is intentionally empty in committed appsettings and must be supplied by environment or development-only config.
- `ConfigurationValidator.ValidateJwtSettings` requires secret/issuer/audience and a secret length of at least 32.
- Docker Compose injects `JwtSettings__Secret`, `JwtSettings__Issuer`, and `JwtSettings__Audience`.
- Gateway, Todo, Category, Messaging, and Realtime validate bearer tokens independently.

Code:

- `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Configuration/ConfigurationValidator.cs`
- `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Extensions/JwtAuthenticationExtensions.cs`
- `Planora.ApiGateway/Program.cs`
- service `Program.cs` files

## CORS And CSRF

CORS origins are configured in appsettings under `Cors:AllowedOrigins`. Development defaults include local frontend hosts such as `http://localhost:3000` and `http://127.0.0.1:3000`.

For browser state-changing requests, CSRF is required:

- frontend obtains token from `GET /auth/api/v1/auth/csrf-token`;
- token is stored in readable cookie `XSRF-TOKEN`;
- frontend sends matching `X-CSRF-Token` header on `POST`, `PUT`, `PATCH`, and `DELETE`;
- backend compares header/cookie in constant time.

Code:

- `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Middleware/CsrfProtectionMiddleware.cs`
- `Services/AuthApi/Planora.Auth.Api/Controllers/AuthenticationController.cs`
- `frontend/src/lib/csrf.ts`
- `frontend/src/lib/api.ts`

## Email Delivery

Auth email delivery is implemented by `Services/AuthApi/Planora.Auth.Infrastructure/Services/Messaging/EmailService.cs`.

Providers:

| Provider | Behavior |
|---|---|
| `Log` | Default. Does not send mail; writes verification/reset links to Auth API logs for local development and e2e tests. |
| `GmailSmtp` | Sends real messages through Gmail SMTP using the configured Gmail address and Google App Password. |
| `Smtp` | Sends real messages through the configured SMTP host/port/credentials. |

Gmail local setup:

```env
Email__Provider=GmailSmtp
Email__Username=your-gmail-address@gmail.com
Email__Password=your-16-character-google-app-password
Email__FromName=Planora
```

Do not use a normal Google account password. Gmail SMTP requires account-level 2-Step Verification and a Google App Password for this flow. Keep `Email__Password` in `.env` or a production secret manager only.

Code:

- `Services/AuthApi/Planora.Auth.Infrastructure/Services/Messaging/EmailOptions.cs`
- `Services/AuthApi/Planora.Auth.Infrastructure/Services/Messaging/SmtpEmailMessageSender.cs`
- `docker-compose.yml`
- `.env.example`

## Frontend API URL

`frontend/next.config.js` reads:

1. `NEXT_PUBLIC_API_URL`
2. `NEXT_PUBLIC_API_GATEWAY_URL`
3. fallback `http://localhost:5132`

The value must be an `http` or `https` origin with no path/query/hash. Invalid values fall back to `http://localhost:5132`.

### Same-Wi-Fi / LAN sharing

For browsing from another device on the same Wi-Fi, run the launcher with `-Lan`
(`.\Start-Planora-Local.ps1 -Lan`). It opens the Windows Firewall for ports `3000` and `5132`
(inbound, LocalSubnet only) and prints the `http://<laptop-lan-ip>:3000` URL to share. Most of
what used to be manual is now automatic:

- **Frontend API URL** — no env needed. `frontend/src/lib/config.ts` (`getApiBaseUrl()`) makes the
  browser target the gateway on the *same host the page was opened from*: opening
  `http://<laptop-lan-ip>:3000` automatically calls `http://<laptop-lan-ip>:5132`, while
  `http://localhost:3000` calls `http://localhost:5132`. This keeps CSRF/auth cookies scoped to one
  browser host.
- **CORS** — the gateway's development policy already accepts loopback **and** RFC1918 private-LAN
  origins (`Program.cs::IsLoopbackOrPrivateLanOrigin`), so no `Cors__AllowedOrigins__*` entry is
  required for a LAN IP. Production stays an explicit allow-list.
- **CSP** — in development `connect-src` allows `http:/https:/ws:/wss:` (`src/middleware.ts`), so a
  page served from a LAN IP can reach the same-host gateway. It also omits
  `upgrade-insecure-requests` in dev so the browser does not rewrite the `http://…:5132` API calls
  to HTTPS, which the local gateway does not serve.

- **Email links** — auto-synced. Auth generates verification / password-reset links server-side from
  `Frontend__BaseUrl`. `-Lan` now overrides `Frontend__BaseUrl` (and `NEXT_PUBLIC_API_URL` /
  `NEXT_PUBLIC_API_GATEWAY_URL`) in the child process environment with the **freshly detected** LAN IP
  on every run, so a changed DHCP lease never leaves these pinned to a stale address. A hardcoded
  `Frontend__BaseUrl=http://192.168.x.y:3000` in `.env` is no longer needed for LAN sharing; if one is
  present, `-Lan` supersedes it for that run.

If a teammate still cannot open the LAN URL, the cause is **local network interference, not the
server** (the launcher health-checks prove the server is up). In rough order of likelihood:

- **Firewall rule not created (most common).** Opening the firewall needs administrator rights, so
  `-Lan` raises one UAC prompt — **approve it**. If it is declined or missed, no inbound rule exists
  and Windows refuses every remote device before the app is even reached. The launcher now **verifies**
  the rule after creating it, and the closing banner states per port whether inbound is genuinely open.
  If it reports the firewall CLOSED, open an elevated PowerShell (Win+X → "Terminal (Admin)") and run
  the `New-NetFirewallRule` command it prints, then re-run `-Lan`.
- **TUN-mode VPN on the host (the one thing the launcher cannot override).** A "route-everything" VPN
  (sing-box / xray / Clash / Happ in TUN / strict-route mode) can blackhole the LAN subnet even with the
  firewall open — so the LAN IP stops answering, both from other devices and from this host itself. `-Lan`
  now *proves* this: after startup it opens a real TCP connection to the LAN IP, and if that fails while
  the firewall is open and the ports are bound, the verdict names the VPN/TUN adapter as the culprit. Fix:
  turn on the VPN client's **Allow LAN / Bypass LAN** (split-tunnel) setting, or stop the VPN while you
  share — either makes it work immediately. No host-side script can lift a VPN's own kernel-level filter.
- **Wrong IP.** Open the exact URL `-Lan` prints (the current IP), not an old bookmarked address — the
  DHCP-assigned IP changes between sessions.
- **Wi-Fi isolation.** Both devices must be on the same non-guest / non-AP-isolated network.

`-Lan` creates the firewall rule across all profiles, so a `Public` Wi-Fi profile does not block it
once the rule exists.

Code:

- `frontend/next.config.js`
- `frontend/src/lib/config.ts`

## Gateway Route Files

| Environment | File | Downstream host style |
|---|---|---|
| local/default | `Planora.ApiGateway/ocelot.json` | `127.0.0.1:<service-port>` |
| Docker | `Planora.ApiGateway/ocelot.Docker.json` | Compose service names such as `auth-api:80` |

Both route files expose canonical friendship routes under `/auth/api/v1/friendships*` and legacy routes under `/friendships*`.

## Database Connection Strings

| Service | Connection string key | Database |
|---|---|---|
| Auth | `ConnectionStrings:AuthDatabase` | `planora_auth_db` |
| Todo | `ConnectionStrings:TodoDatabase` | `planora_todo` |
| Category | `ConnectionStrings:CategoryDatabase` | `planora_category` |
| Messaging | `ConnectionStrings:MessagingDatabase` | `planora_messaging` |
| Realtime | `ConnectionStrings:RealtimeDatabase` | `planora_realtime` |

Startup code waits for PostgreSQL and initializes schemas for Auth, Todo, Category, and Messaging. If user-owned EF migrations exist, startup applies pending migrations. If no migrations exist in the assembly, startup creates the schema from the current EF model through `DatabaseStartup.EnsureReadyAsync`.

The Realtime service is wired conditionally: when `ConnectionStrings:RealtimeDatabase` is set it persists notifications (durable `Notifications` / `NotificationDeliveries` / `OutboxMessages` tables) and serves the read API; when it is absent the service falls back to ephemeral SignalR pushes only. Realtime's schema is **not** created at startup — apply its EF migration explicitly with `Planora.Migrator --service realtime` (the runner creates `planora_realtime` if it does not yet exist) before first boot.

## Known Configuration Inconsistencies To Keep Visible

| Topic | What is inconsistent | Practical guidance |
|---|---|---|
| Auth local port descriptions | `ocelot.json` routes Auth REST to `5030`; Docker maps Auth to host `5031`; `.env.example` had a reversed local port note before this documentation pass. | Use the gateway for browser/API calls; verify service-specific ports in `appsettings.json` before manual direct calls. |
| PostgreSQL local port | Docker exposes host `5433`; some launch profile examples mention `5432`. | Use `5433` for host-to-container PostgreSQL. |
| `CORS_ALLOWED_ORIGINS` | Present in `.env.example`, but services read `Cors:AllowedOrigins` from configuration. | Override with `Cors__AllowedOrigins__0`, `Cors__AllowedOrigins__1`, etc. when using environment variables. |
| Todo description length | validators allow 5000 characters, EF Core column config sets max length 2000. | Treat 2000 as the safe persisted limit until code is reconciled. |

## Data Retention (automatic cleanup)

A daily background job (`RetentionBackgroundService`, in `BuildingBlocks.Infrastructure.Retention`)
physically removes stale data. It runs in every service that owns purgeable data and is governed by the
`Retention` configuration section (env `Retention__*`). It ships **disabled** and, once enabled, **dry-run
by default**; every pass is guarded by a Postgres advisory lock (single-instance), a per-pass tripwire, and
batched deletes.

| Key | Default | Meaning |
|---|---|---|
| `Retention__Enabled` | `false` | Master switch. When false the scheduler never runs. |
| `Retention__DryRun` | `true` | Count and log only — delete nothing. On-prod rehearsal. |
| `Retention__RunAtHourUtc` | `3` | UTC hour (0–23) the daily pass fires. |
| `Retention__RunOnStartup` | `true` | Also run a catch-up pass shortly after every startup, so data already past its window is cleaned on each launch — not only at `RunAtHourUtc`. |
| `Retention__StartupDelaySeconds` | `60` | Delay before the startup catch-up pass, letting the database/broker come up first. |
| `Retention__BatchSize` | `1000` | Rows deleted per batch statement. |
| `Retention__MaxDeletionsPerRun` | `50000` | Tripwire: a pass finding more eligible rows aborts and alerts. |
| `Retention__SoftDeleteGraceDays` | `7` | Grace before a soft-deleted row is physically purged. |
| `Retention__CompletedTaskDays` | `30` | Days a task may sit completed before auto-deletion. |
| `Retention__ReadNotificationDays` | `3` | Days a read notification survives after being read. |
| `Retention__UnreadNotificationDays` | `90` | Days an unread notification survives. |
| `Retention__NotificationDeliveryDays` | `30` | Days a delivery-audit row survives after delivery. |
| `Retention__OutboxProcessedDays` | `7` | Days a processed outbox message survives. |
| `Retention__InboxProcessedDays` | `7` | Days a processed inbox message survives. |
| `Retention__ExpiredRefreshTokenDays` | `30` | Grace past a refresh token's expiry before purge. |
| `Retention__PurgeLoginHistory` | `false` | Opt-in: enable login-history purge (forensics). |
| `Retention__LoginHistoryDays` | `180` | Login-history retention when enabled. |
| `Retention__PurgeAuditLogs` | `false` | Opt-in: enable audit-log purge (forensics). |
| `Retention__AuditLogDays` | `365` | Audit-log retention when enabled. |
| `Retention__PurgeUsedRecoveryCodes` | `true` | Reap spent 2FA recovery codes (safe housekeeping). |
| `Retention__RecoveryCodeUsedDays` | `30` | Age (by `UsedAt`) at which spent recovery codes are purged. |
| `Retention__PurgeFriendships` | `false` | Opt-in: purge terminal (rejected/cancelled/removed) friendship rows. |
| `Retention__FriendshipTerminalDays` | `90` | Age at which terminal friendship rows are purged. |
| `Retention__PurgeMessages` | `false` | Opt-in: purge old messages (user content — a product decision). |
| `Retention__MessageDays` | `365` | Age (by `CreatedAt`) at which messages are purged when enabled. |

Each content vector also has its own `Retention__Purge*` toggle (e.g. `PurgeSoftDeleted`,
`PurgeCompletedTasks`, `PurgeReadNotifications`, `PurgeOutboxInbox`, `PurgeExpiredRefreshTokens`), all
defaulting to true so the master switch enables them together.

**Rollout:** set `Retention__Enabled=true` with `Retention__DryRun=true`, watch the `Retention[...]`
"would delete N" logs and the `planora.retention.*` metrics for a day, then set `Retention__DryRun=false`.
The security-forensics vectors stay off until a deliberate compliance decision enables them.
