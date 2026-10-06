# ADR-0005: CSRF middleware is bounded to Auth API

- Status: Accepted historical decision; implementation has diverged (see current audit below)
- Date: 2026-05-26
- Supersedes: clarifies the prior policy noted in [`docs/auth-security.md`](../auth-security.md) "Known Security Gaps / Clarifications"

## Context

Planora uses two independent credentials:

- a short-lived **JWT access token** that lives in frontend memory and is sent
  on every API call via the `Authorization: Bearer` header;
- a long-lived **refresh token** that lives in an `HttpOnly; SameSite=Strict`
  cookie whose `Path` is set to `/auth/api/v1/auth`.

CSRF is a risk only for credentials that the **browser sends automatically**.
The access token is a custom header; a cross-origin attacker cannot forge an
`Authorization` header without reading the token from frontend memory, and
the token is unreadable from JS contexts other than the Planora frontend's
own runtime. The refresh cookie is sent automatically, but only to paths
under `/auth/api/v1/auth` — the rest of the API surface is bearer-only.

The configuration described by this decision originally registered
`CsrfProtectionMiddleware` only in Auth API
(`Services/AuthApi/Planora.Auth.Api/Program.cs` calls `app.UseCsrfProtection()`).
The four other services (Todo, Category, Messaging, Realtime) and the
API Gateway do not register it.

This split is correct, but until this ADR it was not documented as an
explicit decision — it appeared in the "Known Security Gaps" section of
`auth-security.md` as something that "should be confirmed". This ADR
confirms it and locks the contract in.

The frontend sets `withCredentials: true` on both axios clients
(`frontend/src/lib/api.ts`, `frontend/src/lib/auth-public.ts`). This causes
the browser to attach every same-origin cookie to every request, but the **path-scoped** refresh cookie is sent only when the request URL is
under `/auth/api/v1/auth`. It does not travel on normal non-Auth API routes. The `XSRF-TOKEN` cookie (non-`HttpOnly`, no
path restriction) is sent everywhere, which the historical decision intended only Auth API to validate. The current
implementation validates it in four additional services, as recorded below.

## Decision

CSRF middleware **is and will remain** registered only in Auth API.

The contract is:

1. **Cookie-based authentication credentials may exist only on Auth API
   routes.** The single existing cookie credential is the refresh token,
   scoped to `Path=/auth/api/v1/auth`.
2. **All other services accept bearer tokens only.** No service may add a
   cookie credential without also adding `app.UseCsrfProtection()` in the
   same change.
3. **A new state-changing endpoint on Auth API** is automatically protected
   by the existing middleware — no per-endpoint action required.
4. **A new service that accepts the refresh-token cookie** (today none do)
   would have to register the middleware AND extend the refresh-cookie
   `Path`. The change is documented in this ADR so that future work
   surfaces both halves together rather than half-fixing the contract.

The frontend `withCredentials: true` setting stays, because the refresh
flow on Auth API needs it. The setting is broader than strictly required
(it would suffice to set it only on the Auth-API-targeted axios instance),
but the cost is zero: cookies are path-scoped at the server side, so they
simply do not travel to services that have no cookie configured.

## Consequences

### Positive

- One implementation of CSRF, one place to audit, one set of tests
  (`CsrfProtectionMiddleware` + the unit tests in `Planora.UnitTests`).
- No friction on the bearer-only services: a malicious site cannot trigger
  an authenticated request to `/todos/api/v1/todos` because the browser
  has no way to put a `Bearer` header on a cross-origin fetch.
- Operators can rely on `planora.csrf.rejections{reason}` (see
  [`observability.md`](../observability.md)) being driven entirely by
  Auth API traffic, which keeps the dashboard cardinality low and the
  alert noise interpretable.

### Negative

- The contract is implicit unless documentation is read. **This ADR is
  the explicit form.** Any new service that adds cookie-based auth must
  reference this ADR in the PR description.
- A future architectural decision to widen the refresh-cookie scope
  (e.g. a refresh-on-every-service strategy for offline-first apps)
  would invalidate this ADR and require:
  - `app.UseCsrfProtection()` on every affected service;
  - extending the refresh-cookie `Path` accordingly;
  - updating `planora.csrf.rejections` cardinality budget and the
    Grafana alert thresholds in `docs/observability.md`.

### Risk if violated

If a non-Auth service is ever extended to accept a session cookie without
also registering CSRF middleware, the system loses one of its primary
defenses against cross-origin attacks. The pull-request checklist in
[`CONTRIBUTING.md`](../../CONTRIBUTING.md) and the architectural invariant
in [`INVARIANTS.md`](../INVARIANTS.md) `INV-AUTH-3` codify the rule.

## Alternatives considered

### A. Register CSRF middleware on every service

Pros: defense in depth, no risk of future drift.
Cons: middleware that runs on requests with no cookie to validate is dead
weight; rejection counters become noisy with `missing_cookie` events from
bearer-only traffic that would never have been a CSRF surface anyway; the
mental model becomes harder ("CSRF middleware everywhere" suggests that
cookie auth exists on those services, which it does not).

Rejected.

### B. Drop `withCredentials: true` from the non-Auth axios client

Pros: tightens the surface — non-Auth services literally never receive
the cookies.
Cons: requires the frontend to maintain a separate axios instance per
target service, doubling the interceptor and retry code; the current
two-instance split (`api.ts` for authenticated app traffic, `auth-public.ts`
for the auth bootstrap that must avoid recursive token refresh) is already
the design boundary, and re-splitting it again to cover cookies would
duplicate the auth-public pattern across multiple service-specific axios
instances. The marginal security gain over the status quo (cookies are
already path-scoped at the server) does not justify the new abstraction
layer.

Rejected.

## References

- `Services/AuthApi/Planora.Auth.Api/Program.cs` (`app.UseCsrfProtection()`)
- `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Middleware/CsrfProtectionMiddleware.cs`
- `frontend/src/lib/csrf.ts`, `frontend/src/lib/api.ts`, `frontend/src/lib/auth-public.ts`
- [`docs/auth-security.md`](../auth-security.md) "CSRF Protection"
- [`docs/INVARIANTS.md`](../INVARIANTS.md) `INV-AUTH-3`
- [`docs/observability.md`](../observability.md) `planora.csrf.rejections{reason}` counter
- ADR-0003 (`docs/DECISIONS/0003-csrf-double-submit.md`) — the underlying CSRF mechanism this ADR scopes

## Current Implementation Audit (2026-10-06)

The original date and decision above are retained as history. The inspected code at
`8b072a9f3da0e57e1aecfce0e814d780506b3078` **does not implement the Auth-only scope**.
No application code was changed to make it match this ADR during the documentation audit.

| Host | Current `UseCsrfProtection()` | Credential model |
|---|---|---|
| Auth | yes | bearer REST plus refresh-cookie bootstrap |
| Todo | yes | bearer REST; double-submit required on HTTP mutations |
| Category | yes | bearer REST; double-submit required on HTTP mutations |
| Messaging | yes | bearer REST; double-submit required on HTTP mutations |
| Collaboration | yes | bearer REST; double-submit required on HTTP mutations |
| Realtime | no | bearer REST/WebSockets |
| Gateway | no | routes requests; downstream services compare CSRF tokens |

The common middleware checks POST/PUT/PATCH/DELETE without testing whether an auth
cookie was supplied and exempts `application/grpc*` content types. Consequently a CLI
client with a valid bearer token also needs a matching `XSRF-TOKEN` cookie and
`X-CSRF-Token` header for mutations on the five services. The refresh-cookie path is
still limited to Auth; wider CSRF enforcement did not introduce cookie authentication
on the other services. Rejection metrics can originate in any of the five services,
so the historical Auth-only dashboard assumption no longer holds.

Sources: [Auth Program](../../Services/AuthApi/Planora.Auth.Api/Program.cs),
[Todo Program](../../Services/TodoApi/Planora.Todo.Api/Program.cs),
[Category Program](../../Services/CategoryApi/Planora.Category.Api/Program.cs),
[Messaging Program](../../Services/MessagingApi/Planora.Messaging.Api/Program.cs),
[Collaboration Program](../../Services/CollaborationApi/Planora.Collaboration.Api/Program.cs),
and [CSRF middleware](../../BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Middleware/CsrfProtectionMiddleware.cs).
The current [API contract](../API.md#auth) and [security reference](../auth-security.md#csrf-protection)
take precedence when implementing a client. A future architecture change should explicitly
reconcile the scope and associated invariants instead of assuming this historical decision
matches the current pipelines.
