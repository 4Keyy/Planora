# Authentication And Security

This document describes the implementation inspected on **2026-10-06** at commit
`8b072a9f3da0e57e1aecfce0e814d780506b3078`. It separates implemented controls from
their limits; it does not certify a deployed environment.

Use the [API contract](API.md), [authorization coverage map](security-idor-coverage.md),
[secret operations](secrets-management.md), and [repository audit](audits/2026-10-06.md)
for endpoint details, known findings, configuration, and validation evidence.

## Authentication Model

Planora uses JWT access tokens and server-side refresh tokens.

| Credential | Storage | Lifetime | Code |
|---|---|---|---|
| Access token | frontend memory only | configured in `JwtSettings:AccessTokenExpirationMinutes` | `frontend/src/store/auth.ts`, `AuthenticationController.cs` |
| Refresh token | httpOnly `refresh_token` cookie; DB stores the SHA-256 `RefreshTokenHash`, not the raw token | registration and refresh use `JwtSettings:RefreshTokenExpirationDays`; initial remembered login uses 30 days | `AuthenticationController.cs`, login/refresh handlers, `RefreshToken` entity |
| CSRF token | readable `XSRF-TOKEN` cookie and `X-CSRF-Token` header | 1 hour | `AuthenticationController.GetCsrfToken`, `CsrfProtectionMiddleware.cs` |

The frontend persists user metadata, roles, email-verification state and expiry timestamps
in `sessionStorage` (`planora-auth`), but not raw access or refresh tokens. Access expiry
comes from JWT `exp`; register/login/refresh JSON `expiresAt` is **refresh-token expiry**.

Refresh tokens are 32-byte random base64url values. The server hashes them with SHA-256,
rotates them on refresh, and detects replay of tokens revoked as `Replaced by new token`:
that path revokes all active refresh tokens and rotates the account's security stamp.
An initial remembered login gets a 30-day refresh lifetime, but subsequent refresh uses
the configured lifetime (7 days by settings-class default), preserving `rememberMe` only
for cookie persistence. Non-remembered sessions and registration use session cookies.
Logout and single-session revocation revoke refresh credentials; they do not directly
invalidate already-issued access JWTs. See [the exact HTTP failure behavior](API.md#post-authapiv1authrefresh).

### The landing page's sandbox session

The landing page (`/`) runs the product's real task list and command palette against an in-memory
transport, and those components require a session, so it seeds one: an unsigned `alg: none` JWT
the client decodes and never verifies (`frontend/src/lib/demo/enable.ts`). The server never sees it,
and three rules keep it that way:

- **It installs only after `restoreSession()` has finished, and only when there is no real
  session** (`frontend/src/app/_landing/demo-sandbox.tsx`). Installing on mount raced the restore:
  an anonymous visitor's failed refresh called `clearAuth()`, which broadcasts a logout to every
  other tab over `BroadcastChannel`; a seeded token already in the store was POSTed to the real
  `validate-token` endpoint; and a signed-in visitor's real token was overwritten, then erased when
  the sandbox tore down. A signed-in visitor now keeps their session and the block links to
  `/tasks`.
- **Teardown is silent and complete.** `disableDemo()` restores the previous axios adapter, calls
  `clearAuth(true)` (no broadcast), restores the page's real `XSRF-TOKEN` cookie, and removes the
  persisted identity — as does `pagehide`, so a reload never starts from a made-up user.
- **It never reaches the auth endpoints.** Every call the sandbox makes goes through `api`, whose
  transport is the in-memory adapter; realtime is off for a demo session; and the only code that
  talks to `lib/auth-public.ts` — the restore — has already run before the seed exists.

### Reading the user id from claims — always check `sub` AND `NameIdentifier`

The access token carries the user id in the JWT `sub` claim, but every service's JWT handler runs with the default inbound claim mapping (`JwtBearerOptions.MapInboundClaims = true`), which **remaps `sub` to `ClaimTypes.NameIdentifier`** on the validated principal. Server code must therefore resolve the subject as `User.FindFirst("sub") ?? User.FindFirst(ClaimTypes.NameIdentifier)` (the SignalR hub is unaffected — `Context.UserIdentifier` already derives from `NameIdentifier`). Reading only the raw `"sub"` claim returns null against a real token and 401s every call.

This fallback is the standing convention — `CurrentUserContext`, `CurrentUserService`, and the rate-limit `PartitionKey` all use it. A handler that reads only `"sub"` is a latent bug: it returns `401`/`403` where the id is required (it broke the realtime notification REST endpoints with `401` — `NotificationsController`/`ConnectionsController`/`PresenceHub` — and the Auth friendship lookups `GetFriendIds`/`AreFriends` with `403`, since the null id fails their self-scoped guard).

### The client's 401 handling stops at the anonymous auth endpoints

`frontend/src/lib/api.ts` answers a 401 by refreshing once and replaying the request, and clears
auth — broadcasting a logout to every open tab — when that fails. That is right for an expired
session and wrong for an endpoint whose 401 means something else. Login, register, logout, refresh
**and the two password-reset endpoints** (`/auth/reset-password`, `/auth/request-password-reset`)
pass their 401 straight to the caller. The reset endpoints were added after an expired reset link
(401 `INVALID_TOKEN`) was found to start a refresh and a broadcast logout, and — for a visitor
signed in in another tab, where the refresh succeeds and the replay 401s again — to sign them out
of every tab.

## Login / Register Cookie Contract

Auth API sets:

```text
refresh_token=<opaque-token>; HttpOnly; SameSite=Strict; Path=/auth/api/v1/auth
```

`Secure` is selected by `Security:RequireHttps` when explicitly configured; otherwise
it defaults to `!IWebHostEnvironment.IsDevelopment()`. It does not depend on the backend's
`Request.IsHttps`, so the default remains correct behind a TLS-terminating proxy.
An explicit `Security__RequireHttps=false` disables this flag even outside Development;
reserve that override for local HTTP runs. Production must enforce HTTPS at the edge.
The cookie is host-only (no `Domain`), HttpOnly, SameSite=Strict and path-scoped as above.
Logout deletes it after the action executes; authentication/CSRF rejection before the
action does not execute cookie cleanup.

Code:

- `Services/AuthApi/Planora.Auth.Api/Controllers/AuthenticationController.cs`
- `docs/DECISIONS/0002-http-only-refresh-cookies.md`

## CSRF Protection

State-changing HTTP requests to **Auth, Todo, Category, Messaging and Collaboration** require the double-submit token, including bearer-authenticated requests and public login/register:

1. frontend calls `GET /auth/api/v1/auth/csrf-token`;
2. Auth API sets readable `XSRF-TOKEN`;
3. frontend sends `X-CSRF-Token` on `POST`, `PUT`, `PATCH`, and `DELETE`;
4. middleware validates header/cookie equality using constant-time comparison.

Frontend startup uses `getCsrfToken()` instead of unconditional token fetch so reloads reuse an existing `XSRF-TOKEN` cookie. The CSRF helper also shares concurrent token fetches, and the public auth client retries one CSRF `403` after clearing the readable cookie. Silent refresh calls are serialized in `auth-public.ts` so one browser reload cannot send competing refresh-token rotation requests.

**Client-side refresh discipline (anti-storm).** The axios interceptor in `api.ts` enforces two rules so background traffic cannot stampede `/auth/refresh` into its `10/min` rate limit (which would otherwise cascade into spurious logouts):

1. **Best-effort background calls never drive refresh or logout.** A request marked `suppressErrorLog` (the notification-summary poll that runs while the WebSocket is down, and the subtask/comment polls) that receives a `401` rejects silently. The caller already keeps its last-known value; the access token is renewed by the scheduled refresh or the next foreground request — never by a background tick.
2. **A `429` on refresh is transient, not an invalid session.** A rate-limited refresh does **not** clear auth or redirect (the httpOnly refresh cookie is still valid). The interceptor backs off for the `Retry-After` window (default 60s, clamped to 1–300s) before any further refresh, and `restoreSession` applies the same rule at startup so a `429` cannot hard-log-out every open tab. Genuine `401`/cookie-expiry failures still clear auth and redirect as before.

Code:

- `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Middleware/CsrfProtectionMiddleware.cs`
- `frontend/src/lib/csrf.ts`
- `frontend/src/lib/api.ts`
- `frontend/src/lib/auth-public.ts`
- `docs/DECISIONS/0003-csrf-double-submit.md`

The comparison applies to POST/PUT/PATCH/DELETE. GET/HEAD/OPTIONS are not checked,
and `application/grpc*` content types bypass the comparison so the internal gRPC
transport can use its service-key interceptor. Realtime and the gateway do not register
CSRF middleware. Realtime HTTP mutations use bearer authentication and role/self scope.

Failure is `403` JSON `{ "error": "CSRF_VALIDATION_FAILED", "message": "CSRF token validation failed" }`.
The readable cookie is Strict, path `/`, expires after one hour, and follows the same
Secure configuration as the refresh cookie. The token endpoint disables service rate
limiting; the gateway's global/auth windows still apply.

[ADR 0005](DECISIONS/0005-csrf-coverage-bounded-to-auth-api.md#current-implementation-audit-2026-10-06)
records the original Auth-only decision and the current divergence. The wider middleware
coverage does **not** mean those services accept cookie credentials: their protected REST
endpoints still require bearer JWTs.

## Email Verification Delivery

Registration, password reset, and account-security notifications use `IEmailService`. The default provider is `Email__Provider=Log`, which writes links to Auth API logs and sends no email. Real Gmail delivery is enabled with `Email__Provider=GmailSmtp`, `Email__Username=<gmail address>`, and `Email__Password=<Google App Password>`.

Gmail delivery uses `smtp.gmail.com:587` with TLS by default. The Gmail app password is a secret and must stay in `.env`, Docker/CI secrets, or a production secret manager. The service does not log SMTP passwords and logs successful real sends by subject and recipient. The `Log` provider exposes reset/verification bearer links in logs: treat those logs as sensitive and use actual delivery in production.

Email verification status is exposed in user DTOs as both `isEmailVerified` and `emailVerifiedAt`. The email verification frontend route automatically confirms `?token=...` links (once per token, guarded against StrictMode's double effect, since a second request would find the token spent) and refreshes the current access token when an authenticated session is present.

The reset and verification tokens are never displayed or editable in the frontend: both pages read them from the link's query string. The password-reset request page carries the address to the "check your inbox" step in `sessionStorage` (this tab only, cleared on a successful reset), and that step shows it masked (`a•••n@gmail.com`). Its copy says "If … has an account", because `request-password-reset` answers identically whether or not the address exists — the page must not undo the endpoint's protection against account enumeration.

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

Internal gRPC calls use `GrpcSettings:ServiceKey`. Compose maps the `GRPC_SERVICE_KEY` input to `GrpcSettings__ServiceKey`; a standalone process must set the configuration key itself. Every gRPC server in the system (Auth, Todo, Category, Messaging, Realtime) registers `ServiceKeyServerInterceptor`, which reads the `x-service-key` metadata header from each incoming call using a constant-time comparison and returns `StatusCode.Unauthenticated` if the header is missing or does not match. The client-side `ServiceKeyClientInterceptor` attaches the secret to every outbound call. Both interceptors reject a key shorter than 16 characters at startup. Collaboration is a gRPC client; the gateway is an HTTP/WebSocket proxy and needs no service key. The shared key authenticates a trusted service, not an end user; servers trust user ids in internal payloads. The key does not itself encrypt transport or provide per-service identity.

Configure with:

```text
GrpcSettings__ServiceKey=<random-value-at-least-32-characters>
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
- `POST /realtime/api/v1/notifications/send` (target is the caller)
- `POST /realtime/api/v1/notifications/broadcast`
- `GET /system/info`, on a service exposing the shared controller; no gateway route is committed

Role data is configured in Auth persistence. `RoleConfiguration` seeds `Admin` and `User` roles.

## Password Security

Registration enforces length and character complexity through FluentValidation. Change-password and reset additionally use the infrastructure password validator. These controls have different scope:

- 8-128 characters;
- uppercase, lowercase, digit, special character;
- common weak-password blocklist;
- sequential character detection;
- repeating character detection;
- optional HIBP k-anonymity check enabled by `Password:CheckCompromised` default true;
- previous-password reuse check, default history limit 5, **on change-password only**; reset does not check or append password history.

Code:

- validators under `Services/AuthApi/Planora.Auth.Application/Features/Authentication/Validators`
- `Services/AuthApi/Planora.Auth.Infrastructure/Services/Authentication/PasswordValidator.cs`
- `Services/AuthApi/Planora.Auth.Infrastructure/Services/Authentication/PasswordHasher.cs`
- `Services/AuthApi/Planora.Auth.Domain/Entities/PasswordHistory.cs`

HIBP lookup failures are logged and do not block the password operation.

Reset and change-password additionally run `PasswordValidator.IsStrongPassword` (the common-password list, four ascending characters, four repeats); registration does not. The frontend mirrors this split: `PASSWORD_SCHEMA` for create-account, `NEW_PASSWORD_SCHEMA` (the same plus `isEasyToGuess`) for the reset form and the profile's change-password form, to give immediate pattern feedback. The server remains authoritative: the client cannot precompute a breached-password lookup or account-specific password history.

### Password Hashing

Passwords are hashed with **PBKDF2** (`Rfc2898DeriveBytes`, HMAC-SHA512, 210,000 iterations, 16-byte random salt, 32-byte derived key) in `PasswordHasher`. Each hash is stored as a self-describing string carrying its algorithm version, iteration count and salt, so the iteration count can be raised over time without breaking existing hashes. Verification is constant-time (`CryptographicOperations.FixedTimeEquals`). On a successful login the handler calls `IPasswordHasher.NeedsRehash`; any hash produced with an older iteration count is transparently re-hashed with the current parameters. The same hasher protects 2FA recovery codes.

## Two-Factor Authentication

TOTP 2FA is exposed through `UsersController`:

| Endpoint | Purpose |
|---|---|
| `POST /auth/api/v1/users/me/2fa/enable` | start pending setup; `secret` plus `qrCodeUrl` containing base64 PNG bytes, despite the field name |
| `POST /auth/api/v1/users/me/2fa/confirm` | confirm with TOTP code — activates 2FA, returns 10 recovery codes |
| `POST /auth/api/v1/users/me/2fa/disable` | disable with password |

Packages `Otp.NET` and `QRCoder` are centrally referenced in `Directory.Packages.props`.

**Two-phase enrolment (no self-lockout).** `enable` only *provisions* the secret — `User.BeginTwoFactorSetup` stores it while leaving `TwoFactorEnabled` **false** (`User.IsTwoFactorPending` is then true). The login gate keys off `TwoFactorEnabled`, so a user who scans the QR but never confirms is never asked for a TOTP they cannot yet produce. `confirm` verifies the first code against the pending secret and only then calls `User.ConfirmTwoFactor`, which flips the flag and persists it. Re-calling `enable` before confirmation simply overwrites the pending secret; calling `confirm` with no pending setup returns `2FA_NOT_SETUP`, and confirming an already-active account returns `2FA_ALREADY_ENABLED`.

### TOTP Secret Encryption

TOTP secrets are encrypted at rest using ASP.NET Core Data Protection (`IDataProtector`). The protector purpose is `"Planora.TwoFactorSecret.v1"`. Encryption and decryption are applied by an EF Core value converter registered in `AuthDbContext`. The Data Protection key ring is scoped to the application name `"Planora.Auth"` and persisted to Redis under `Planora:Auth:DataProtection-Keys`, so encrypted secrets stay decryptable across container restarts.

Code:

- `Services/AuthApi/Planora.Auth.Infrastructure/Persistence/AuthDbContext.cs` — value converter wires encryption into EF Core
- `Services/AuthApi/Planora.Auth.Infrastructure/DependencyInjection.cs` — registers `AddDataProtection().SetApplicationName(...).PersistKeysToStackExchangeRedis(...)`

### 2FA Recovery Codes

When 2FA is confirmed, the server generates 10 single-use recovery codes formatted `XXXXX-XXXXX` using a cryptographically secure alphabet (`A-Z0-9`). Codes are hashed with PBKDF2 (HMAC-SHA512, 210,000 iterations) before storage and can be used in place of a TOTP code at login. Using a code marks it as consumed. Successful pending confirmation generates the set once. Confirmation of an already-enabled
account returns `2FA_ALREADY_ENABLED`; these endpoints provide no separate regenerate operation.
To generate a new set, disable 2FA with the password, begin enrolment and confirm again.
The login validator accepts six decimal TOTP digits or an uppercase `XXXXX-XXXXX` recovery code.

TOTP uses a 20-byte Base32 secret, 30-second steps and a ±2-step verification window.
Successful verification reserves `totp:used:{userId}:{timeStep}` in Redis with `NX` and
a three-minute TTL. A reused step or Redis failure rejects the TOTP (fail closed);
an unused recovery code remains an alternative. This replay policy differs from the
fail-open security-stamp policy below.

Code:

- `Services/AuthApi/Planora.Auth.Application/Common/Interfaces/IRecoveryCodeService.cs`
- `Services/AuthApi/Planora.Auth.Infrastructure/Services/Security/RecoveryCodeService.cs`
- `Services/AuthApi/Planora.Auth.Domain/Entities/UserRecoveryCode.cs`
- `Services/AuthApi/Planora.Auth.Domain/Repositories/IUserRecoveryCodeRepository.cs`

## Access Token Invalidation (Security Stamp)

The following successful commands write a per-user UTC stamp under
`security:stamp:{userId}` in Redis. All six backend JWT validators compare JWT `iat`
against that stamp in `OnTokenValidated`; Auth also has `TokenBlacklistFilter`.
A token issued before an available stamp is rejected with `401`.

| Command | Why the stamp rotates |
|---|---|
| `ChangePasswordCommandHandler` | Password is the primary credential — historical tokens become invalid. |
| `ResetPasswordCommandHandler` | Same reason; reset is just a different proof-of-ownership for the same password change. |
| `ChangeEmailCommandHandler` | Email change re-binds the identity; old tokens carry stale identity claims. |
| `Disable2FACommandHandler` | Disabling 2FA reduces the account's security posture — invalidate live sessions so the user re-authenticates on every device. |
| `RevokeAllSessionsCommandHandler` | The command's raison d'être. Refresh-token revocation alone leaves outstanding access tokens valid until their natural expiry; the stamp rotation makes "revoke all" actually do what the name says. |
| `DeleteUserCommandHandler` | Account is soft-deleted — outstanding tokens must not continue to hit endpoints whose handlers do not separately check `IsDeleted`. |
| `RefreshTokenCommandHandler` (reuse path) | A presented refresh token already revoked with reason `"Replaced by new token"` indicates either a buggy client racing its own refresh or an attacker presenting a stolen value; the server cannot distinguish these causes. The handler revokes the entire chain and rotates the stamp so any already-minted access tokens become invalid on next call. See INV-AUTH-6. |

The stamp rotates **only on successful execution** of the command. A wrong-password attempt does not invalidate active sessions — otherwise an observer could DoS a legitimate user. Regression tests under `tests/Planora.UnitTests/Services/AuthApi/Users/Handlers/` pin both the success-path stamp call and the failure-path absence-of-call.

The stamp is NOT rotated on 2FA enable / 2FA confirm because enabling strengthens the account; invalidating live sessions there would be friction without security benefit.

The stamp is NOT rotated on profile-only updates (`UpdateUserCommandHandler` — first name, last name, avatar) even though first name, last name and avatar claims can become stale until the next token is issued. It is NOT rotated on revoking a *single* refresh token (`RevokeSessionCommandHandler`) because the user chose that specific session — other sessions remain authorized by design.

### Forward-looking rotation policy

Any future command that mutates the security posture of an account MUST rotate the stamp. The exhaustive list of expected future rotation points — to be added when their handlers ship:

- **Role assignment / revocation** — adding or removing a `UserRole` row changes the claim set and therefore the access surface.
- **Admin force-logout** — an admin-initiated session-revocation against a target user must invalidate that user's access tokens, not just refresh tokens.
- **Manual lock / suspend** issued by an operator — same reason as `RevokeAllSessions` but driven by an admin command rather than the user.
- **Email change via admin override** — bypassing the standard confirmation flow still re-binds identity, so stamp rotation applies.
- Any new command that changes the set of access claims, the set of permitted scopes, or the set of resources the user can reach.

A narrower wiring contract is enforced by `SecurityStampUsageContractTests` (`tests/Planora.UnitTests/Services/AuthApi/Infrastructure/SecurityStampUsageContractTests.cs`): a source-file scan asserts that every handler injecting `ISecurityStampService` also invokes `SetStampAsync`. This source scan does not discover a new security-sensitive handler that never injects the interface; reviewers still need to assess rotation requirements.

### Stamp enforcement coverage

Every service that accepts JWT-authenticated requests must wire the stamp check into its `JwtBearerOptions.OnTokenValidated` event. Without it, a rotated token would still work against that service's endpoints until natural expiry — defeating the rotation. Current coverage:

| Service | Mechanism | Verified by |
|---|---|---|
| Auth API | inline `OnTokenValidated` calling `SecurityStampValidator.IsTokenRevokedAsync` in `Planora.Auth.Infrastructure.DependencyInjection.AddJwtAuthentication` | `tests/Planora.UnitTests/Services/AuthApi/Infrastructure/AuthJwtStampWiringTests.cs` |
| Category API | shared `AddJwtAuthenticationForConsumer` | `JwtAuthenticationExtensions.cs` |
| Todo API | shared `AddJwtAuthenticationForConsumer` | `JwtAuthenticationExtensions.cs` |
| Collaboration API | shared `AddJwtAuthenticationForConsumer` | `Services/CollaborationApi/Planora.Collaboration.Api/Program.cs` |
| Messaging API | inline `OnTokenValidated` | `Services/MessagingApi/Planora.Messaging.Api/Program.cs` |
| Realtime API | inline `OnTokenValidated` | `Services/RealtimeApi/Planora.Realtime.Api/Program.cs` |
| API Gateway | JWT signature, issuer, audience and lifetime; no Redis stamp check | downstream consumer enforces stamp |

Enforcement limits:

- The stamp TTL is hardcoded to **120 minutes**, not derived from access-token settings.
  An access lifetime longer than that can outlive the revocation marker. Keep lifetime
  below the marker lifetime until this relationship is enforced in code.
- Missing Redis/stamp, malformed stamp or Redis errors fail open. When a valid stamp
  exists, absent/unparseable `iat` fails closed. These choices are pinned in
  [SecurityStampValidatorTests](../tests/Planora.UnitTests/BuildingBlocks/Security/SecurityStampValidatorTests.cs).
- JWT `iat` has second precision but the stamp includes fractions of a second; a token
  issued immediately after rotation in the same second can still compare as older.
- A successful WebSocket handshake checks the stamp once. Existing hub connections
  are not disconnected on a later stamp rotation or JWT expiry by the inspected code.
- The public body-token `validate-token` handler does not perform the Redis revocation
  checks used by the authenticated middleware/filter. It is not a revocation oracle.

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
| `auth` | 10/minute/partition | refresh, logout, token validation, reset operations; CSRF GET disables service limiting |
| `avatar-upload` | 5/hour/partition | `POST /users/me/avatar` |
| `data` | 50/minute/partition | reserved for data-heavy endpoints |

The partition function prefers authenticated user id (`sub` / `NameIdentifier`), then
`RemoteIpAddress`. **The inspected service pipelines call `UseRateLimiter` before
`UseAuthentication`**, so requests normally reach the limiter without an authenticated
principal and use the IP partition. This can couple users behind one NAT or proxy.
The gateway also intentionally partitions by remote IP. The service configuration
lives in `AddConfiguredRateLimiting(IConfiguration)`. IPv4-mapped IPv6 addresses (`::ffff:1.2.3.4`) are normalized to their IPv4 form so dual-stack listeners do not split a client's quota into two buckets. The backend is selected at startup:

- `RateLimiting:Backend = Redis` (production, set in `docker-compose.yml` for every service) — partitions are backed by `RedisRateLimitPartition.GetFixedWindowRateLimiter` from `RedisRateLimiting.AspNetCore`, so counters can be shared by replicas and services using the same Redis and configured prefixes. The in-memory alternative is process-local.
- Unset or anything else (tests, local dev) — falls back to the in-memory `FixedWindowRateLimiter`. The integration test factory deliberately leaves it unset, so the in-memory path stays the default for tests.

Auth controller adds the stricter named policies on top via `[EnableRateLimiting("...")]`.

Code:

- `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Extensions/ServiceCollectionExtensions.cs`
- `Services/AuthApi/Planora.Auth.Api/Controllers/AuthenticationController.cs`

### Gateway edge rate limiting

The API Gateway throttles at the edge with the ASP.NET Core rate limiter (`AddRateLimiter` / `UseRateLimiter`), **not** with Ocelot's per-route `RateLimitOptions`. Two chained per-IP fixed windows apply, both partitioned by `RemoteIpAddress`:

| Scope | Limit | Applies to |
|---|---:|---|
| global | 100/minute/IP | every gateway request |
| auth | 30/minute/IP | `POST/GET/... /auth/api/v1/auth/*` (CORS `OPTIONS` preflights bypass it) |

Auth traffic must satisfy both windows; this is a coarse edge layer on top of the stricter per-operation limits the Auth service enforces (`login` 5/min, `register` 3/min, `auth` 10/min).

Both committed Ocelot route files disable their per-route limiter; the active gateway
throttle is the ASP.NET Core limiter. Gateway auth traffic must pass both 100/minute
global and 30/minute auth windows, then the stricter Auth service window.
Gateway forwarded headers are opt-in with `ForwardedHeaders:KnownProxies`. The parser
accepts individual IP addresses with `IPAddress.TryParse`, **not CIDR ranges** despite
comments suggesting CIDR support. Configure actual trusted proxy addresses and verify
`RemoteIpAddress`; otherwise multiple clients can share one proxy bucket.

Service rejections currently advertise `Retry-After: 60` even for the hourly avatar policy;
it is not a computed remaining-window duration. The `data` policy is defined but not
attached to the inspected controllers.

Code:

- `Planora.ApiGateway/Program.cs` (`AddRateLimiter`)
- `Planora.ApiGateway/ocelot.json`, `Planora.ApiGateway/ocelot.Docker.json`

## SignalR Topic Subscription

`NotificationHub.Subscribe()` validates the requested topic against a static allowlist before adding the connection to a group. Only `system`, `announcements`, and `todos` are permitted. Requests for any other topic are silently rejected and logged as warnings.

`JoinTask` uses Todo's `CheckTaskCommentAccess` through a fail-closed branch authorizer.
Typing requires local joined-room membership. A later removal of task access does not
evict existing task-room members or recheck each typing call. Query-string bearer
tokens are accepted on gateway `/realtime*` and backend `/hubs*` paths for WebSockets;
proxy and request-log configuration must avoid recording those query credentials.

Code:

- [NotificationHub](../Services/RealtimeApi/Planora.Realtime.Infrastructure/Hubs/NotificationHub.cs)
- [TaskBranchAuthorizer](../Services/RealtimeApi/Planora.Realtime.Infrastructure/Grpc/TaskBranchAuthorizer.cs)

## Security Headers

All backend services apply security headers through a single shared middleware. The middleware is registered with `app.UseSecurityHeaders()` which calls `SecurityHeadersMiddleware`. Headers set:

- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `X-XSS-Protection: 1; mode=block`
- `Content-Security-Policy: default-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self';`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Strict-Transport-Security` outside development

Frontend static headers (set in `next.config.js`):

- `X-Frame-Options`
- `X-Content-Type-Options`
- `Referrer-Policy`
- `Permissions-Policy`
- **production only:** `Strict-Transport-Security` (HSTS), `Cross-Origin-Opener-Policy: same-origin`,
  `Cross-Origin-Resource-Policy: same-origin`. The two Cross-Origin-* headers are gated to production
  because browsers only honour them on a secure context (HTTPS / `localhost`) and ignore them — with
  a console warning — when the page is served over plain HTTP, e.g. a teammate opening the shared LAN
  dev URL `http://192.168.x.y:3000`. Emitting them in dev added only that warning, never protection.

> **LAN dev sharing.** When the dev server is shared with `next dev -H 0.0.0.0`, `next.config.js`
> auto-populates `allowedDevOrigins` with the host's own non-internal IPv4 addresses (plus anything
> in `NEXT_DEV_ALLOWED_ORIGINS`). Without it, Next 16 treats a teammate's `http://<lan-ip>:3000`
> as a cross-origin dev request and blocks the internal `/_next/*` resources — including the HMR
> websocket (`ws://<lan-ip>:3000/_next/webpack-hmr`). This is dev-only (ignored in production);
> for a fully clean shared experience, serve a production build (`next build` + `next start`), which
> has no HMR websocket or React-DevTools console notice at all.

Content-Security-Policy is set **per-request** with a unique nonce by `src/middleware.ts` (Next.js Edge Middleware) instead of a static header in `next.config.js`. Each request generates a `crypto.randomUUID()`-based nonce in base64, injected into the CSP `script-src` directive. The middleware sets the CSP on both the response and the forwarded request headers, and the root layout (`src/app/layout.tsx`) opts every route into dynamic rendering (`export const dynamic = "force-dynamic"`), so Next.js reads the nonce and stamps it onto its own inline bootstrap scripts. In development, `'unsafe-eval'` is added to support hot-module replacement.

`style-src 'unsafe-inline'` is retained because Tailwind CSS and Next.js SSR emit inline `<style>` tags that cannot be attributed with nonces without forking the framework internals.

Code:

- `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Middleware/SecurityHeadersMiddleware.cs` — single source of truth for all backend services
- `frontend/src/middleware.ts` — per-request nonce CSP for the Next.js app
- `frontend/next.config.js` — static security headers only (CSP removed)

## CORS

Service CORS policies use configured origins with credentials where registered. The
gateway additionally accepts loopback and private IPv4 origins on any port in
**Development**; outside Development its policy uses the configured allow-list.
`AllowAnyOrigin()` with credentials is not used. CORS controls browser response access,
not authorization of non-browser clients.

Code:

- service `Program.cs` files
- `Planora.ApiGateway/Program.cs`
- `*/appsettings.json`

## Hidden Shared Todo Privacy

The normal list/detail paths redact hidden shared/public todos server-side, including the owner's own hidden shared view. This is path-specific: the `join` handler returns an unredacted DTO, as recorded in the [coverage findings](security-idor-coverage.md#known-findings-and-missing-regressions). This protects title, description, dates, tags, shared users, completion metadata, and owner user id for non-owners. The redacted DTO still preserves non-content visual state (`Priority`, `IsPublic`, `HasSharedAudience`, and `IsVisuallyUrgent`) so hidden cards can render the same shared/urgent frame after reload.

Code:

- `Services/TodoApi/Planora.Todo.Application/Features/Todos/HiddenTodoDtoFactory.cs`
- `Services/TodoApi/Planora.Todo.Application/Features/Todos/TodoViewerStateResolver.cs`
- `docs/DECISIONS/0004-viewer-specific-todo-visibility.md`

## Avatar File Pipeline

`POST /auth/api/v1/users/me/avatar` is the only file-upload endpoint in the system. It is defended in depth:

1. **Edge size cap** — `[RequestSizeLimit(6 MB)]` and `[RequestFormLimits(MultipartBodyLengthLimit = 6 MB)]` on the action reject oversized bodies before any handler runs. 6 MB allows 5 MB image + multipart overhead.
2. **Validation** — `UploadAvatarCommandValidator` (FluentValidation) enforces presence, size ≤ 5 MB, and MIME ∈ {`image/jpeg`, `image/png`, `image/webp`}.
3. **Magic-byte sniff** — `ImageSharpImageProcessor` re-checks the first 12 bytes against JPEG (`FF D8 FF`), PNG (`89 50 4E 47 0D 0A 1A 0A`), and WEBP (`RIFF…WEBP`) signatures. A spoofed `Content-Type` cannot bypass this.
4. **Decode + dimension check** — ImageSharp parses the file; rejects anything outside `64×64..4096×4096`. Decode/dimension failures return `INVALID_IMAGE_CONTENT`. Dimensions are checked after decode; the configured limits are not proof of a bounded decoder memory allocation.
5. **Metadata stripping** — `ExifProfile`, `IccProfile`, and `XmpProfile` are explicitly cleared. EXIF GPS and similar privacy leaks cannot survive an upload.
6. **Re-encoding to WebP** — the decoded image is re-emitted as lossy WebP (quality 85). The result is a brand-new byte stream produced by ImageSharp; original container metadata/trailing bytes are not copied. This does not prove that all malicious decoder inputs or information encoded in visible pixels are eliminated.
7. **Variants** — three sizes are produced server-side per upload: `64×64`, `128×128`, `512×512`, each cropped center via Lanczos3. Clients pick the closest fit; bandwidth is saved by avoiding full-resolution downloads for thumbnail rendering.
8. **Storage** — `LocalAvatarStorage.PutAsync` writes variants to `{WebRoot}/avatars/{userId:N}/{contentHash}/{size}.webp`. The hash is the lowercase hex SHA-256 prefix (16 chars) of all variant bytes concatenated. Content-addressed paths make URL invalidation automatic when bytes change.
9. **Old-avatar cleanup** — `LocalAvatarStorage` prunes every prior hash subdirectory for the user on successful `PutAsync`; only the latest revision persists. Account deletion (`DeleteUserCommandHandler`) attempts `DeleteAsync` even if the Redis security-stamp update fails; filesystem cleanup is best-effort, while a stamp failure still propagates. The deleted-account purge (`UserSoftDeletePurgePolicy`) retries avatar removal before deleting any Auth-owned dependent rows or the account. A failed avatar cleanup preserves those rows for the next pass and does not block other accounts. Until 2026-10 nothing called `DeleteAsync`, so a deleted person's photo stayed reachable at its `/avatars/…` URL; copies a browser or proxy already cached under the `immutable` header below can outlive the file.
10. **Path-traversal guard** — storage refuses to write or delete anything that resolves outside the uploads root.
11. **Cache-Control** — `Services/AuthApi/Planora.Auth.Api/Program.cs` configures `UseStaticFiles` to emit `Cache-Control: public, max-age=31536000, immutable` and `X-Content-Type-Options: nosniff` for any URL under `/avatars/`. `ServeUnknownFileTypes` is `false` so only known content types ship.

Validation failures for declared size/MIME return `400` before image processing.
The body cap can return `413`; processor size failure maps to `413`, and an actual
signature failure with an allowed declared MIME maps to `415`. Decode/dimension
failures return `400`. See [the API table](API.md#avatar-upload).

Code: [UploadAvatarCommandHandler](../Services/AuthApi/Planora.Auth.Application/Features/Users/Handlers/UploadAvatar/UploadAvatarCommandHandler.cs), [ImageSharpImageProcessor](../Services/AuthApi/Planora.Auth.Infrastructure/Services/Common/ImageSharpImageProcessor.cs), [LocalAvatarStorage](../Services/AuthApi/Planora.Auth.Infrastructure/Services/Common/LocalAvatarStorage.cs).

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
| `GRPC_SERVICE_KEY` / `GrpcSettings__ServiceKey` | trusted internal caller impersonation | random shared value; restrict internal transport and rotate all participating clients/servers |
| `Cors:AllowedOrigins` | credentialed cross-origin access | explicit production origins; gateway LAN allowance is Development-only |
| HTTPS | token/cookie interception if absent in production | enforce HTTPS and HSTS in production |

Secret handling details are centralized in [`secrets-management.md`](secrets-management.md). Production rollout requirements are in [`production.md`](production.md).

## Vulnerability Disclosure

The repository has a root [`SECURITY.md`](../SECURITY.md) policy. The documented reporting channel is GitHub Private Vulnerability Reporting. No project-specific security email address was found in repository files, so maintainers must enable private vulnerability reporting in GitHub before public release or add a real contact owned by the project.

## Known Security Gaps / Clarifications

The [authorization coverage map](security-idor-coverage.md#known-findings-and-missing-regressions)
records the concrete access-control gaps: public-task `join` bypasses the normal friend
gate and hidden redaction; revoked subtask creators retain edit/delete paths; comment
deletion checks actor identity without current branch access. No application fix is
included in this documentation audit.

| Topic | Observed behavior | Operational implication |
|---|---|---|
| Revocation | stamp errors fail open; TTL is fixed at 120 minutes | Redis availability and access lifetime bound revocation guarantees |
| Live rooms | no eviction/recheck after task access or JWT changes | existing connections can retain subscriptions until disconnect |
| Public token validation | no stamp/blacklist check; expiry computed from current time | use JWT `exp` and authenticated endpoint behavior, not this response, to infer access validity |
| Rate limiting | middleware runs before authentication; trusted proxy parser accepts IPs only | verify actual client IP and avoid promising independent per-user quotas |
| Avatar decode | dimensions checked after decode | retain decoder updates and resource limits; re-encoding is not a universal payload guarantee |
| Email logs | default `Log` provider prints one-time bearer links | restrict log access; configure SMTP for actual production delivery |
| Deployment | [CD workflow](../.github/workflows/cd.yml) exists, but route/listener/secret limitations remain | follow [deployment audit](deployment.md) before rollout; manifests alone do not prove a working deployment |
| Dependencies | the initial npm/NuGet scans reported vulnerable package versions; the XML cryptography dependency is now pinned to patched 10.0.12 | scanner severity is an inventory result, not proof of reachability; see [repository audit](audits/2026-10-06.md) |
| Reporting | GitHub private reporting is policy; settings were not inspected | maintainers must enable the channel or publish a real owned contact |

## XML cryptography dependency correction

Auth Infrastructure explicitly references `System.Security.Cryptography.Xml`
10.0.12 through central package management. This overrides Data Protection's
vulnerable transitive version without suppressing NuGet auditing. Remove the
override only after the upstream dependency graph resolves a patched version
throughout the solution. See the [dated security note](../.github/security/cryptography-xml-2026-10.md)
for advisory references and verification commands.

## Frontend dependency review

The compatible frontend updates include Next.js 16.3.8, sharp 0.35.5 and
source-map-js 1.2.2. The production dependency scan (`npm audit --omit=dev`)
reports no vulnerable packages against the current registry metadata. The full
scan still reports development-tool vulnerabilities; this is not a claim that
the entire package graph is clean. The [dated review](../.github/security/frontend-dependencies-2026-10.md)
lists the remaining advisories and verification boundaries.
