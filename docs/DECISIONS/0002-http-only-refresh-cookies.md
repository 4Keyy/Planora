# ADR 0002: httpOnly Refresh Cookies

## Status

Accepted.

## Context

Refresh tokens are long-lived credentials. Storing them in JavaScript-accessible storage increases XSS blast radius.

## Decision

Store access tokens in frontend memory only and deliver refresh tokens as httpOnly, SameSite=Strict cookies scoped to `/auth/api/v1/auth`.

Register, login, and refresh responses omit the raw refresh token from JSON. Refresh reads only the cookie, rotates the token, and sets a new cookie. Logout revokes when possible and always deletes the cookie.

The frontend serializes concurrent silent refresh calls through `frontend/src/lib/auth-public.ts`. This prevents React Strict Mode, startup hydration, and API retry paths from sending multiple simultaneous refresh requests that would race against refresh-token rotation.

## Consequences

Positive:

- JavaScript cannot read the refresh token.
- Page reloads can restore sessions through silent refresh.
- Refresh token replay is reduced through rotation.
- Parallel browser refresh attempts reuse one network request.

Tradeoffs:

- Browser state-changing auth endpoints need CSRF protection.
- Frontend tests must assert the cookie contract rather than expecting refresh token JSON.
- Debugging refresh requires inspecting Set-Cookie headers and cookie path/samesite behavior.
