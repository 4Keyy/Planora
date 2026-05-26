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

The `Secure` flag is set from `!IWebHostEnvironment.IsDevelopment()`, so it is `true` in every non-development environment regardless of `HttpContext.Request.IsHttps`. This keeps the flag correct behind a TLS-terminating reverse proxy, where the backend sees plain HTTP. On local development it is `false`. Production must still terminate or enforce HTTPS so the cookie is actually transmitted over TLS.

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

## gRPC Inter-Service Authentication

Internal gRPC calls between services are authenticated with a shared secret (`GRPC_SERVICE_KEY`). Every gRPC server in the system (Auth, Todo, Category, Messaging, Realtime) registers `ServiceKeyServerInterceptor`, which reads the `x-service-key` metadata header from each incoming call using a constant-time comparison and returns `StatusCode.Unauthenticated` if the header is missing or does not match. The client-side `ServiceKeyClientInterceptor` attaches the secret to every outbound call. Both interceptors reject a key shorter than 16 characters at startup.

Configure with:

```text
GRPC_SERVICE_KEY=<random-hex-at-least-32-chars>
```

Code:

- `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Grpc/ServiceKeyServerInterceptor.cs`
- `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Grpc/ServiceKeyClientInterceptor.cs`
- `docs/configuration.md` — environment variable reference

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
| `POST /auth/api/v1/users/me/2fa/enable` | generate TOTP setup (secret + QR code URL) |
| `POST /auth/api/v1/users/me/2fa/confirm` | confirm with TOTP code — returns 10 recovery codes |
| `POST /auth/api/v1/users/me/2fa/disable` | disable with password |

Packages `Otp.NET` and `QRCoder` are centrally referenced in `Directory.Packages.props`.

### TOTP Secret Encryption

TOTP secrets are encrypted at rest using ASP.NET Core Data Protection (`IDataProtector`). The protector purpose is `"Planora.TwoFactorSecret.v1"`. Encryption and decryption are applied by an EF Core value converter registered in `AuthDbContext`. The Data Protection key ring is scoped to the application name `"Planora.Auth"` and persisted to Redis under `Planora:Auth:DataProtection-Keys`, so encrypted secrets stay decryptable across container restarts.

Code:

- `Services/AuthApi/Planora.Auth.Infrastructure/Persistence/AuthDbContext.cs` — value converter wires encryption into EF Core
- `Services/AuthApi/Planora.Auth.Infrastructure/DependencyInjection.cs` — registers `AddDataProtection().SetApplicationName(...).PersistKeysToStackExchangeRedis(...)`

### 2FA Recovery Codes

When 2FA is confirmed, the server generates 10 single-use recovery codes formatted `XXXXX-XXXXX` using a cryptographically secure alphabet (`A-Z0-9`). Codes are hashed with BCrypt before storage and can be used in place of a TOTP code at login. Using a code marks it as consumed. New codes are generated on every re-confirmation, replacing all previous codes.

Code:

- `Services/AuthApi/Planora.Auth.Application/Common/Interfaces/IRecoveryCodeService.cs`
- `Services/AuthApi/Planora.Auth.Infrastructure/Services/Security/RecoveryCodeService.cs`
- `Services/AuthApi/Planora.Auth.Domain/Entities/UserRecoveryCode.cs`
- `Services/AuthApi/Planora.Auth.Domain/Repositories/IUserRecoveryCodeRepository.cs`

## Access Token Invalidation (Security Stamp)

Every command that materially changes the security posture of an account rotates a per-user security stamp in Redis. The `TokenBlacklistFilter` validates the stamp on every authorized request; mismatches return `401 Unauthorized` and force the client to re-authenticate.

| Command | Why the stamp rotates |
|---|---|
| `ChangePasswordCommandHandler` | Password is the primary credential — historical tokens become invalid. |
| `ResetPasswordCommandHandler` | Same reason; reset is just a different proof-of-ownership for the same password change. |
| `ChangeEmailCommandHandler` | Email change re-binds the identity; old tokens carry stale identity claims. |
| `Disable2FACommandHandler` | Disabling 2FA reduces the account's security posture — invalidate live sessions so the user re-authenticates on every device. |
| `RevokeAllSessionsCommandHandler` | The command's raison d'être. Refresh-token revocation alone leaves outstanding access tokens valid until their natural expiry; the stamp rotation makes "revoke all" actually do what the name says. |
| `DeleteUserCommandHandler` | Account is soft-deleted — outstanding tokens must not continue to hit endpoints whose handlers do not separately check `IsDeleted`. |

The stamp rotates **only on successful execution** of the command. A wrong-password attempt does not invalidate active sessions — otherwise an observer could DoS a legitimate user. Regression tests under `tests/Planora.UnitTests/Services/AuthApi/Users/Handlers/` pin both the success-path stamp call and the failure-path absence-of-call.

The stamp is NOT rotated on 2FA enable / 2FA confirm because enabling strengthens the account; invalidating live sessions there would be friction without security benefit.

### Stamp enforcement coverage

Every service that accepts JWT-authenticated requests must wire the stamp check into its `JwtBearerOptions.OnTokenValidated` event. Without it, a rotated token would still work against that service's endpoints until natural expiry — defeating the rotation. Current coverage:

| Service | Mechanism | Verified by |
|---|---|---|
| Auth API | inline `OnTokenValidated` calling `SecurityStampValidator.IsTokenRevokedAsync` in `Planora.Auth.Infrastructure.DependencyInjection.AddJwtAuthentication` | `tests/Planora.UnitTests/Services/AuthApi/Infrastructure/AuthJwtStampWiringTests.cs` |
| Category API | shared `AddJwtAuthenticationForConsumer` | `JwtAuthenticationExtensions.cs` |
| Todo API | shared `AddJwtAuthenticationForConsumer` | `JwtAuthenticationExtensions.cs` |
| Messaging API | inline `OnTokenValidated` | `Services/MessagingApi/Planora.Messaging.Api/Program.cs` |
| Realtime API | inline `OnTokenValidated` | `Services/RealtimeApi/Planora.Realtime.Api/Program.cs` |
| API Gateway | downstream services enforce; gateway only routes | n/a (defense-in-depth handled at consumers) |

Code:

- `Services/AuthApi/Planora.Auth.Application/Common/Interfaces/ISecurityStampService.cs`
- `Services/AuthApi/Planora.Auth.Infrastructure/Services/Security/SecurityStampService.cs`
- `Services/AuthApi/Planora.Auth.Api/Filters/TokenBlacklistFilter.cs`
- `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Security/SecurityStampValidator.cs`
- `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Extensions/JwtAuthenticationExtensions.cs`
- Command handlers under `Services/AuthApi/Planora.Auth.Application/Features/Users/Handlers/` and `.../Authentication/Handlers/`.
- See [`INVARIANTS.md`](INVARIANTS.md) `INV-AUTH-4` for the closed-form rule.

## Rate Limiting

A `GlobalLimiter` applies a default cap of 100 requests/minute per IP to every endpoint across all services. Named policies for Auth endpoints provide stricter per-operation limits:

| Policy | Limit | Applied to |
|---|---:|---|
| global | 100/minute/partition | all services (default) |
| `register` | 3/minute/partition | `POST /auth/register` |
| `login` | 5/minute/partition | `POST /auth/login` |
| `auth` | 10/minute/partition | refresh, logout, CSRF |
| `avatar-upload` | 5/hour/partition | `POST /users/me/avatar` |
| `data` | 50/minute/partition | reserved for data-heavy endpoints |

The `GlobalLimiter` and named policies are configured in `AddConfiguredRateLimiting(IConfiguration)` and partitioned by authenticated user id (JWT `sub` / `NameIdentifier`) with fallback to `RemoteIpAddress`. IPv4-mapped IPv6 addresses (`::ffff:1.2.3.4`) are normalized to their IPv4 form so dual-stack listeners do not split a client's quota into two buckets. The backend is selected at startup:

- `RateLimiting:Backend = Redis` (production, set in `docker-compose.yml` for every service) — partitions are backed by `RedisRateLimitPartition.GetFixedWindowRateLimiter` from `RedisRateLimiting.AspNetCore`, so the per-IP counters are shared across every replica of every service. Without this, the in-memory limiter would let an attacker exceed the configured limits by a factor of `N` (the replica count).
- Unset or anything else (tests, local dev) — falls back to the in-memory `FixedWindowRateLimiter`. The integration test factory deliberately leaves it unset, so the in-memory path stays the default for tests.

Auth controller adds the stricter named policies on top via `[EnableRateLimiting("...")]`.

Code:

- `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Extensions/ServiceCollectionExtensions.cs`
- `Services/AuthApi/Planora.Auth.Api/Controllers/AuthenticationController.cs`

## SignalR Topic Subscription

`NotificationHub.Subscribe()` validates the requested topic against a static allowlist before adding the connection to a group. Only `system`, `announcements`, and `todos` are permitted. Requests for any other topic are silently rejected and logged as warnings.

Code:

- `Services/RealtimeApi/Planora.Realtime.Infrastructure/Hubs/NotificationHub.cs`

## Security Headers

All backend services apply security headers through a single shared middleware. The middleware is registered with `app.UseSecurityHeaders()` which calls `SecurityHeadersMiddleware`. Headers set:

- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `X-XSS-Protection: 1; mode=block`
- `Content-Security-Policy: default-src 'self'; style-src 'self'; script-src 'self'; ...`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Strict-Transport-Security` outside development

Frontend static headers (set in `next.config.js`):

- `X-Frame-Options`
- `X-Content-Type-Options`
- `Referrer-Policy`
- `Permissions-Policy`
- production HSTS

Content-Security-Policy is set **per-request** with a unique nonce by `src/middleware.ts` (Next.js Edge Middleware) instead of a static header in `next.config.js`. Each request generates a `crypto.randomUUID()`-based nonce in base64, injected into the CSP `script-src` directive. The middleware sets the CSP on both the response and the forwarded request headers, and the root layout (`src/app/layout.tsx`) opts every route into dynamic rendering (`export const dynamic = "force-dynamic"`), so Next.js reads the nonce and stamps it onto its own inline bootstrap scripts. In development, `'unsafe-eval'` is added to support hot-module replacement.

`style-src 'unsafe-inline'` is retained because Tailwind CSS and Next.js SSR emit inline `<style>` tags that cannot be attributed with nonces without forking the framework internals.

Code:

- `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Middleware/SecurityHeadersMiddleware.cs` — single source of truth for all backend services
- `frontend/src/middleware.ts` — per-request nonce CSP for the Next.js app
- `frontend/next.config.js` — static security headers only (CSP removed)

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

## Avatar File Pipeline

`POST /auth/api/v1/users/me/avatar` is the only file-upload endpoint in the system. It is defended in depth:

1. **Edge size cap** — `[RequestSizeLimit(6 MB)]` and `[RequestFormLimits(MultipartBodyLengthLimit = 6 MB)]` on the action reject oversized bodies before any handler runs. 6 MB allows 5 MB image + multipart overhead.
2. **Validation** — `UploadAvatarCommandValidator` (FluentValidation) enforces presence, size ≤ 5 MB, and MIME ∈ {`image/jpeg`, `image/png`, `image/webp`}.
3. **Magic-byte sniff** — `ImageSharpImageProcessor` re-checks the first 12 bytes against JPEG (`FF D8 FF`), PNG (`89 50 4E 47 0D 0A 1A 0A`), and WEBP (`RIFF…WEBP`) signatures. A spoofed `Content-Type` cannot bypass this.
4. **Decode + dimension check** — ImageSharp parses the file; rejects anything outside `64×64..4096×4096`. Malformed/exploit-crafted payloads fail decode and are rejected with `INVALID_IMAGE_CONTENT`.
5. **Metadata stripping** — `ExifProfile`, `IccProfile`, and `XmpProfile` are explicitly cleared. EXIF GPS and similar privacy leaks cannot survive an upload.
6. **Re-encoding to WebP** — the decoded image is re-emitted as lossy WebP (quality 85). The result is a brand-new byte stream produced by ImageSharp; any polyglot or steganographic payload in the source is discarded.
7. **Variants** — three sizes are produced server-side per upload: `64×64`, `128×128`, `512×512`, each cropped center via Lanczos3. Clients pick the closest fit; bandwidth is saved by avoiding full-resolution downloads for thumbnail rendering.
8. **Storage** — `LocalAvatarStorage.PutAsync` writes variants to `{WebRoot}/avatars/{userId:N}/{contentHash}/{size}.webp`. The hash is the lowercase hex SHA-256 prefix (16 chars) of all variant bytes concatenated. Content-addressed paths make URL invalidation automatic when bytes change.
9. **Old-avatar cleanup** — `LocalAvatarStorage` prunes every prior hash subdirectory for the user on successful `PutAsync`; only the latest revision persists. Account deletion triggers `DeleteAsync` to remove the user's avatar tree entirely.
10. **Path-traversal guard** — storage refuses to write or delete anything that resolves outside the uploads root.
11. **Cache-Control** — `Services/AuthApi/Planora.Auth.Api/Program.cs` configures `UseStaticFiles` to emit `Cache-Control: public, max-age=31536000, immutable` and `X-Content-Type-Options: nosniff` for any URL under `/avatars/`. `ServeUnknownFileTypes` is `false` so only known content types ship.

Error responses use HTTP `413` for size violations and `415` for unsupported media so clients can distinguish them from generic `400` validation errors.

Code: `Services/AuthApi/Planora.Auth.Application/Features/Users/{Commands,Validators,Handlers}/UploadAvatar`, `Services/AuthApi/Planora.Auth.Infrastructure/Services/Common/{ImageSharpImageProcessor,LocalFileStorageService}.cs`.

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
