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

## Production Environment Template

`.env.production.example` documents the keys expected by a production deployment or secret store. It includes:

- public origins: `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_API_GATEWAY_URL`, `Frontend__BaseUrl`, `Cors__AllowedOrigins__0`;
- Compose-compatible secrets: `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `RABBITMQ_USER`, `RABBITMQ_PASSWORD`, `JWT_SECRET`;
- direct ASP.NET overrides for non-Compose deployments: `JwtSettings__Secret`, `ConnectionStrings__*`, `RabbitMq__*`, `RabbitMQ__*`;
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
| `RABBIT_USER` / `RABBIT_PASS` | legacy/documented | Not used by `docker-compose.yml`; use `RABBITMQ_USER` / `RABBITMQ_PASSWORD` for Compose. |
| `RABBITMQ_USER` | required | RabbitMQ default user and service username. |
| `RABBITMQ_PASSWORD` | required | RabbitMQ default password and service password. |
| `RABBITMQ_HOST`, `RABBITMQ_PORT`, `RABBITMQ_VIRTUAL_HOST` | informational | Compose injects service-specific RabbitMQ keys directly. |
| `REDIS_CONNECTION` | optional for some services/scripts | Gateway/realtime use Redis connection strings; local scripts also set Redis connection env values. Compose injects explicit Redis strings for most services. |
| `REDIS_PASSWORD` | required | Redis `requirepass` and password-bearing service connection strings. |
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
| `INCLUDE_ERROR_DETAIL` | optional | Used in database connection/error-detail contexts where configured. Keep false outside development. |
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

For same-Wi-Fi device testing, `localhost` is wrong in email links and frontend API URLs because it points to the device opening the link. Use the laptop LAN IP for all browser-facing origins:

```env
Frontend__BaseUrl=http://<laptop-lan-ip>:3000
NEXT_PUBLIC_API_URL=http://<laptop-lan-ip>:5132
NEXT_PUBLIC_API_GATEWAY_URL=http://<laptop-lan-ip>:5132
HOST=0.0.0.0
Cors__AllowedOrigins__0=http://localhost:3000
Cors__AllowedOrigins__1=http://127.0.0.1:3000
Cors__AllowedOrigins__2=http://<laptop-lan-ip>:3000
```

Restart the launcher after changing these values because Auth API generates links from `Frontend__BaseUrl`, and Next.js inlines `NEXT_PUBLIC_API_URL` at dev-server startup.

If another device still cannot open the LAN URL, check the Windows network profile on the laptop. A `Public` Wi-Fi profile can block inbound access; use a trusted `Private` profile or allow local ports `3000` and `5132` through Windows Firewall.

The frontend CSP intentionally omits `upgrade-insecure-requests` in development. Keeping that directive in local HTTP mode causes browsers to rewrite `http://<laptop-lan-ip>:5132` API calls to HTTPS, which the local gateway does not serve.

For local development, keep the frontend host and API host aligned in the browser. Opening `http://localhost:3000` uses `http://localhost:5132`; opening `http://<laptop-lan-ip>:3000` uses `http://<laptop-lan-ip>:5132`. This keeps CSRF and auth cookies scoped to the same browser host while still allowing email links from other Wi-Fi devices.

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
| Realtime | none found | no EF Core context found |

Startup code waits for PostgreSQL and initializes schemas for Auth, Todo, Category, and Messaging. If user-owned EF migrations exist, startup applies pending migrations. If no migrations exist in the assembly, startup creates the schema from the current EF model through `DatabaseStartup.EnsureReadyAsync`.

## Known Configuration Inconsistencies To Keep Visible

| Topic | What is inconsistent | Practical guidance |
|---|---|---|
| Auth local port descriptions | `ocelot.json` routes Auth REST to `5030`; Docker maps Auth to host `5031`; `.env.example` had a reversed local port note before this documentation pass. | Use the gateway for browser/API calls; verify service-specific ports in `appsettings.json` before manual direct calls. |
| PostgreSQL local port | Docker exposes host `5433`; some launch profile examples mention `5432`. | Use `5433` for host-to-container PostgreSQL. |
| `CORS_ALLOWED_ORIGINS` | Present in `.env.example`, but services read `Cors:AllowedOrigins` from configuration. | Override with `Cors__AllowedOrigins__0`, `Cors__AllowedOrigins__1`, etc. when using environment variables. |
| Todo description length | validators allow 5000 characters, EF Core column config sets max length 2000. | Treat 2000 as the safe persisted limit until code is reconciled. |
