# ADR 0002: httpOnly Refresh Cookies

## Status

Accepted.

## Context

Refresh tokens are long-lived credentials. Storing them in JavaScript-accessible storage increases XSS blast radius.

## Decision

Store access tokens in frontend memory only and deliver refresh tokens as httpOnly, SameSite=Strict cookies scoped to `/auth/api/v1/auth`.

Register, login, and refresh responses omit the raw refresh token from JSON. Refresh reads only the cookie, rotates the token, and sets a new cookie. Logout revokes when possible and deletes the cookie when its action executes.

The frontend serializes concurrent silent refresh calls through `frontend/src/lib/auth-public.ts`. This prevents React Strict Mode, startup hydration, and API retry paths from sending multiple simultaneous refresh requests that would race against refresh-token rotation.

## Consequences

Positive:

- JavaScript cannot read the refresh token.
- Page reloads can restore sessions through silent refresh.
- Refresh token replay is reduced through rotation.
- Concurrent refresh attempts within one browser runtime reuse one network request.

Tradeoffs:

- Browser state-changing auth endpoints need CSRF protection.
- Frontend tests must assert the cookie contract rather than expecting refresh token JSON.
- Debugging refresh requires inspecting Set-Cookie headers and cookie path/samesite behavior.

## Current Implementation Audit (2026-10-06)

The cookie decision remains implemented. `Secure` follows an explicit
`Security:RequireHttps` value, otherwise defaults to non-Development. The cookie is
host-only, Strict and scoped to `/auth/api/v1/auth`. Registration/non-remembered login
use session cookies; remembered login sets an expiry. Initial remembered refresh tokens
last 30 days, but rotation uses `JwtSettings:RefreshTokenExpirationDays` while retaining
the persistence flag. JSON `expiresAt` denotes refresh expiry, not JWT `exp`.

The frontend refresh promise serializes calls within one browser runtime; it is not a
cross-tab mutex or proof that simultaneous clients cannot trigger replay detection.
Reuse of a replaced token revokes all active refresh tokens and rotates a security stamp.
Logout deletes the cookie only when the action runs; an earlier authentication/CSRF
failure bypasses that action. Logout alone does not revoke an existing access JWT.

Sources: [AuthenticationController](../../Services/AuthApi/Planora.Auth.Api/Controllers/AuthenticationController.cs),
[LoginCommandHandler](../../Services/AuthApi/Planora.Auth.Application/Features/Authentication/Handlers/Login/LoginCommandHandler.cs),
[RefreshTokenCommandHandler](../../Services/AuthApi/Planora.Auth.Application/Features/Authentication/Handlers/RefreshToken/RefreshTokenCommandHandler.cs),
and [current auth reference](../auth-security.md).
