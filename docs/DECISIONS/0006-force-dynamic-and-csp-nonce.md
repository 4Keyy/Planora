# ADR-0006: Per-request CSP nonces require dynamic HTML in the current frontend

- Status: Accepted; implementation rechecked on 2026-10-06
- Original decision date: 2026-05-28
- Scope: frontend rendering strategy and script CSP

## Context

`frontend/src/app/layout.tsx` exports `dynamic = "force-dynamic"` for the App
Router tree. `frontend/src/middleware.ts` creates a new base64 nonce from a
random UUID for each matched request. It places the nonce in `x-nonce` and the
CSP on the forwarded request headers, and sets that CSP on the response.
Next.js uses the request CSP when emitting its own inline framework scripts.
The layout currently does not read `x-nonce` itself.

Production `script-src` is `'self' 'nonce-{nonce}'`. It permits same-origin
external scripts and inline scripts carrying the matching nonce; it does not
include script `'unsafe-inline'` or `'unsafe-eval'`. Development adds
`'unsafe-eval'`. `style-src` retains `'self' 'unsafe-inline'` for current inline
styles. See [`auth-security.md`](../auth-security.md) for the complete policy
and its separate connection/image origin rules.

A statically cached HTML response cannot safely be combined with a newly issued
nonce policy unless its script attributes and policy are made consistent. The
current repository has no build-generated inline-script hash manifest, HTML
nonce-rewriting layer or static-route CSP exception. Removing the dynamic
export alone is therefore not a complete migration.

## Decision

Keep the root dynamic export and middleware's per-request nonce pipeline
coupled. Preserve the existing script policy until a replacement is implemented
and verified against an actual production build.

This is the repository's current trade-off, not a claim that this policy proves
absence of XSS or is the strongest possible configuration for every Next.js
version. CSP supplements output encoding, safe rendering and server-side
validation; it does not replace them.

## Consequences

### Security and rendering

- Inline framework scripts must receive the same nonce allowed by the response.
- All routes inherit per-request rendering, including the public landing page.
- Development and production policies differ, so development-only verification
  does not establish that production bootstrap/hydration is usable.
- The inline-style allowance remains broader than the inline-script allowance.
- Dynamic rendering reduces opportunities for static HTML caching. Exact TTFB,
  cache-hit ratio and bundle-size effects require dated measurements in the
  deployed environment; no fixed ratio or universal latency cost is asserted here.

### Current verification scope

[`frontend/src/test/middleware.test.ts`](../../frontend/src/test/middleware.test.ts)
checks request/response CSP behavior, nonce presence, origin handling and
production/development differences.
[`frontend/src/test/app/template.test.tsx`](../../frontend/src/test/app/template.test.tsx)
and the route tests exercise selected rendering behavior; they do not prove
all production inline scripts are allowed by the browser.

The Playwright UI project uses a production frontend in CI. It covers selected
auth/profile/task flows, with skip behavior when the frontend is unreachable;
it is not a dedicated complete CSP conformance test. Before changing this
trade-off, inspect actual HTML and response headers, verify hydration under
production CSP, and check the browser console for blocked framework scripts.

## Revisit conditions

A replacement must be a reviewable implementation with passing production
browser checks, for example:

1. A build step derives hashes from the actual inline scripts emitted by the
   selected Next.js build and supplies a matching strict CSP for static HTML.
2. A rendering/proxy strategy safely applies matching HTML nonces and headers
   without sharing one request's nonce with another visitor.
3. Another explicitly reviewed policy/rendering design preserves the intended
   protection and supports the routes it makes static.

These are options to investigate, not installed capabilities or completed work.
There is no concrete upstream issue or hash-manifest dependency recorded in
this repository. Any future dependency/API claim must be verified against its
then-current implementation and documentation.

## Alternatives considered

| Alternative | Current assessment |
|---|---|
| Remove root `force-dynamic` alone | Incomplete: does not solve the current HTML/CSP nonce consistency requirement |
| Segment-level dynamic exports | Useful only once some routes no longer require the current runtime nonce strategy; does not itself create a static-compatible policy |
| Build-generated script hashes | A possible migration, absent from the current build; must regenerate and verify on every build/update |
| Relax scripts to `'unsafe-inline'` | Rejected by this decision because it weakens protection against injected inline script |
| Serve static HTML through middleware/Edge only | Moving execution location alone does not stamp a new nonce into already-built inline-script attributes |

## References

- [`frontend/src/app/layout.tsx`](../../frontend/src/app/layout.tsx) — root dynamic export and providers.
- [`frontend/src/middleware.ts`](../../frontend/src/middleware.ts) — nonce and CSP pipeline.
- [`frontend/next.config.js`](../../frontend/next.config.js) — static security headers and proxies.
- [`docs/frontend.md`](../frontend.md) — current rendering and browser boundaries.
- [`docs/testing.md`](../testing.md) — suite scopes, coverage exclusions and dated checks.
- [ADR-0003](0003-csrf-double-submit.md) — a separate cookie/request-header protection boundary.
