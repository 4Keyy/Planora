# Authentication And Security

This document describes the security model that is visible in code and configuration.

## Authentication Model

Planora uses JWT access tokens and server-side refresh tokens.

| Credential | Storage | Lifetime | Code |
|---|---|---|---|
| Access token | frontend memory only | configured in `JwtSettings:AccessTokenExpirationMinutes` | `frontend/src/store/auth.ts`, `AuthenticationController.cs` |
| Refresh token | httpOnly `refresh_token` cookie plus server-side DB row | configured in `JwtSettings:RefreshTokenExpirationDays` | `AuthenticationController.cs`, `RefreshToken` entity/config |
| CSRF token | readable `XSRF-TOKEN` cookie and `X-CSRF-Token` header | 1 hour | `AuthenticationController.GetCsrfToken`, `CsrfProtectionMiddleware.cs` |

The frontend persists user metadata and expiry timestamps in session storage, but not raw access or refresh tokens.

## Login / Register Cookie Contract

Auth API sets:

```text
refresh_token=<opaque-token>; HttpOnly; SameSite=Strict; Path=/auth/api/v1/auth
```

The `Secure` flag is based on `HttpContext.Request.IsHttps`. On local HTTP it is false. Production must terminate or enforce HTTPS so cookies are sent securely.

Code:

- `Services/AuthApi/Planora.Auth.Api/Controllers/AuthenticationController.cs`
- `docs/DECISIONS/0002-http-only-refresh-cookies.md`

## CSRF Protection

State-changing browser requests to Auth API require the double-submit token:

1. frontend calls `GET /auth/api/v1/auth/csrf-token`;
2. Auth API sets readable `XSRF-TOKEN`;
3. frontend sends `X-CSRF-Token` on `POST`, `PUT`, `PATCH`, and `DELETE`;
4. middleware validates header/cookie equality using constant-time comparison.

Frontend startup uses `getCsrfToken()` instead of unconditional token fetch so reloads reuse an existing `XSRF-TOKEN` cookie. The CSRF helper also shares concurrent token fetches, and the public auth client retries one CSRF `403` after clearing the readable cookie. Silent refresh calls are serialized in `auth-public.ts` so one browser reload cannot send competing refresh-token rotation requests.

Code:

- `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Middleware/CsrfProtectionMiddleware.cs`
- `frontend/src/lib/csrf.ts`
- `frontend/src/lib/api.ts`
- `frontend/src/lib/auth-public.ts`
- `docs/DECISIONS/0003-csrf-double-submit.md`

Important: CSRF middleware was found in Auth API startup. Other services receive CSRF headers from the frontend but do not appear to validate them in their pipelines.

## Email Verification Delivery

Registration, password reset, and account-security notifications use `IEmailService`. The default provider is `Email__Provider=Log`, which writes links to Auth API logs and sends no email. Real Gmail delivery is enabled with `Email__Provider=GmailSmtp`, `Email__Username=<gmail address>`, and `Email__Password=<Google App Password>`.

Gmail delivery uses `smtp.gmail.com:587` with TLS by default. The Gmail app password is a secret and must stay in `.env`, Docker/CI secrets, or a production secret manager. The service does not log SMTP passwords and only logs successful real sends by subject and recipient.

Email verification status is exposed in user DTOs as both `isEmailVerified` and `emailVerifiedAt`. The email verification frontend route automatically confirms `?token=...` links and refreshes the current access token when an authenticated session is present.

Code:

- `Services/AuthApi/Planora.Auth.Infrastructure/Services/Messaging/EmailService.cs`
- `Services/AuthApi/Planora.Auth.Infrastructure/Services/Messaging/SmtpEmailMessageSender.cs`
- `Services/AuthApi/Planora.Auth.Application/Common/DTOs/UserDto.cs`
- `frontend/src/app/auth/verify-email/page.tsx`

## JWT Validation

Every protected service validates JWT locally.

Required settings:

- `JwtSettings:Secret`
- `JwtSettings:Issuer`
- `JwtSettings:Audience`

Docker Compose injects:

- `JwtSettings__Secret`
- `JwtSettings__Issuer=Planora.Auth`
- `JwtSettings__Audience=Planora.Clients`

Code:

- `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Configuration/ConfigurationValidator.cs`
- `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Extensions/JwtAuthenticationExtensions.cs`
- `Planora.ApiGateway/Program.cs`
- service `Program.cs` files

## Authorization And Roles

Most APIs require `[Authorize]`. Admin-only endpoints are marked with `[Authorize(Roles = "Admin")]`.

Confirmed admin-only routes:

- `GET /auth/api/v1/users`
- `GET /auth/api/v1/users/{userId}`
- `GET /auth/api/v1/users/statistics`
- `GET /realtime/api/v1/connections/stats`
- `POST /realtime/api/v1/notifications/broadcast`

Role data is configured in Auth persistence. `RoleConfiguration` seeds `Admin` and `User` roles.

## Password Security

Password validation includes:

- 8-128 characters;
- uppercase, lowercase, digit, special character;
- common weak-password blocklist;
- sequential character detection;
- repeating character detection;
- optional HIBP k-anonymity check enabled by `Password:CheckCompromised` default true;
- previous-password reuse check using password history limit default 5.

Code:

- validators under `Services/AuthApi/Planora.Auth.Application/Features/Authentication/Validators`
- `Services/AuthApi/Planora.Auth.Infrastructure/Services/Authentication/PasswordValidator.cs`
- `Services/AuthApi/Planora.Auth.Infrastructure/Services/Authentication/PasswordHasher.cs`
- `Services/AuthApi/Planora.Auth.Domain/Entities/PasswordHistory.cs`

HIBP lookup failures are logged and do not block the password operation.

## Two-Factor Authentication

TOTP 2FA is exposed through `UsersController`:

| Endpoint | Purpose |
|---|---|
| `POST /auth/api/v1/users/me/2fa/enable` | generate/setup 2FA |
| `POST /auth/api/v1/users/me/2fa/confirm` | confirm with code |
| `POST /auth/api/v1/users/me/2fa/disable` | disable with password |

Packages `Otp.NET` and `QRCoder` are centrally referenced in `Directory.Packages.props`.

## Rate Limiting

Configured policies:

| Policy | Limit |
|---|---:|
| `register` | 3/minute/IP |
| `login` | 5/minute/IP |
| `auth` | 10/minute/IP |
| `data` | 50/minute/IP |

Auth controller applies `register`, `login`, and `auth`. Other controllers did not show explicit `[EnableRateLimiting("data")]` usage in inspected files.

Code:

- `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Extensions/ServiceCollectionExtensions.cs`
- `Services/AuthApi/Planora.Auth.Api/Controllers/AuthenticationController.cs`

## Security Headers

Backend services append common headers:

- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `X-XSS-Protection: 1; mode=block`
- `Content-Security-Policy`
- `Strict-Transport-Security` outside development

Frontend `next.config.js` also sets:

- `X-Frame-Options`
- `X-Content-Type-Options`
- `Referrer-Policy`
- `Permissions-Policy`
- `Content-Security-Policy`
- production HSTS

Code:

- service `Program.cs` files
- `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Middleware/SecurityHeadersMiddleware.cs`
- `frontend/next.config.js`

## CORS

Services use explicit configured origins with credentials. Development defaults include local frontend origins. `AllowAnyOrigin()` with credentials is not used in the inspected service configuration.

Code:

- service `Program.cs` files
- `Planora.ApiGateway/Program.cs`
- `*/appsettings.json`

## Hidden Shared Todo Privacy

Hidden shared/public todos are redacted server-side. This protects title, description, dates, tags, shared users, completion metadata, and owner user id for non-owners. The redacted DTO still preserves non-content visual state (`Priority`, `IsPublic`, `HasSharedAudience`, and `IsVisuallyUrgent`) so hidden cards can render the same shared/urgent frame after reload.

Code:

- `Services/TodoApi/Planora.Todo.Application/Features/Todos/HiddenTodoDtoFactory.cs`
- `Services/TodoApi/Planora.Todo.Application/Features/Todos/TodoViewerStateResolver.cs`
- `docs/DECISIONS/0004-viewer-specific-todo-visibility.md`

## Logging And Sensitive Data

Structured logging uses Serilog and shared logging helpers. API Gateway explicitly avoids logging Authorization token details in JWT events. HTTP logging middleware is used across services and is described in shared infrastructure.

Code:

- `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Logging`
- `Planora.ApiGateway/Program.cs`
- service `Program.cs` files

## Security-Sensitive Configuration

| Setting | Risk | Recommendation |
|---|---|---|
| `JWT_SECRET` / `JwtSettings__Secret` | token forgery if weak or leaked | generate strong secret, at least 32 chars, identical across services |
| `POSTGRES_PASSWORD` | database compromise | use strong local/prod values, do not commit `.env` |
| `REDIS_PASSWORD` | Redis access; required by Docker Redis | keep synchronized with Redis connection strings |
| `RABBITMQ_PASSWORD` | message broker access | use non-default values outside throwaway local dev |
| `Cors:AllowedOrigins` | credentialed cross-origin access | keep explicit origins only |
| HTTPS | token/cookie interception if absent in production | enforce HTTPS and HSTS in production |

Secret handling details are centralized in [`secrets-management.md`](secrets-management.md). Production rollout requirements are in [`production.md`](production.md).

## Vulnerability Disclosure

The repository has a root [`SECURITY.md`](../SECURITY.md) policy. The documented reporting channel is GitHub Private Vulnerability Reporting. No project-specific security email address was found in repository files, so maintainers must enable private vulnerability reporting in GitHub before public release or add a real contact owned by the project.

## Known Security Gaps / Clarifications

| Topic | Observation | Action |
|---|---|---|
| Production deployment automation | Production baseline exists, but no automated deploy/promotion workflow is committed. | Implement the chosen hosting pipeline after owner selects platform. |
| RabbitMQ AMQP binding | Compose binds AMQP to `127.0.0.1:5672`. | Keep broker traffic private in non-local environments. |
| CSRF coverage | CSRF middleware is registered in Auth API, not in Todo/Category/Messaging/Realtime pipelines. | Confirm intended scope; add middleware to other cookie-sensitive services only if they accept cookie auth. |
| Security contact ownership | GitHub Private Vulnerability Reporting is documented, but repository settings cannot be verified from code. | Owner must enable it or add a real security email/contact before public release. |
