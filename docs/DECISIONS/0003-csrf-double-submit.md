# ADR 0003: CSRF Double-Submit Cookie

## Status

Accepted.

## Context

The browser automatically sends the httpOnly refresh cookie to the Auth API. Without CSRF protection, an attacker-controlled page could trigger state-changing requests that carry that cookie.

## Decision

Use a double-submit CSRF token:

1. `GET /auth/api/v1/auth/csrf-token` sets a readable `XSRF-TOKEN` cookie.
2. Frontend clients read the cookie and send `X-CSRF-Token` on `POST`, `PUT`, `PATCH`, and `DELETE`.
3. `CsrfProtectionMiddleware` compares cookie and header using constant-time comparison.

The public auth client implements the same CSRF mechanism as the main API client, but stays separate from the main API client to avoid refresh-interceptor recursion.

The frontend CSRF helper deduplicates concurrent `GET /auth/api/v1/auth/csrf-token` calls. Startup initialization uses `getCsrfToken()` so an existing readable cookie is reused instead of rotating `XSRF-TOKEN` during session restore. If a public auth POST still receives a CSRF `403`, the public auth client clears the readable cookie and retries once with a newly fetched token.

## Consequences

Positive:

- State-changing cookie-auth requests fail without a matching header.
- Refresh and validate-token calls work with `UseCsrfProtection()`.
- CSRF failures are explicit `403` responses.
- Startup session restore avoids rotating the CSRF cookie while a refresh request is being prepared.

Tradeoffs:

- The CSRF token endpoint must be reachable before auth POSTs.
- XSS is not solved by CSRF; CSP and avoiding token storage remain necessary.
- Tests must cover both missing and matching cookie/header behavior.

## Current Implementation Audit (2026-10-06)

The double-submit mechanism remains implemented, but its current scope is wider
than the original refresh-cookie rationale: Auth, Todo, Category, Messaging and
Collaboration call `UseCsrfProtection()`. Realtime and the gateway do not. Bearer-only
mutations on the five protected services still require the cookie/header pair.
`application/grpc*` content types are exempt; safe HTTP methods bypass comparison.

The readable cookie uses path `/`, Strict, a one-hour expiry and the same configurable
Secure policy as the refresh cookie. Rejection returns `403` JSON with error
`CSRF_VALIDATION_FAILED`; there is no login/register path exemption. CSRF GET disables
service rate limiting, although gateway rate limiting remains active.

The frontend helper deduplicates fetches within a runtime. A public-auth 403 is retried
once with a new token; this is not proof that every 403 originated in CSRF middleware.
See [ADR 0005's implementation divergence](0005-csrf-coverage-bounded-to-auth-api.md#current-implementation-audit-2026-10-06),
[the middleware](../../BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Middleware/CsrfProtectionMiddleware.cs),
and [the current API contract](../API.md#auth).
