# ADR-0006: `force-dynamic` global + per-request CSP nonce stay until hash-based CSP is wired

- Status: Accepted
- Date: 2026-05-28
- Relates to: master-plan T2.7 (Phase 2)
- Supersedes / clarifies: the open question called out in `docs/ROADMAP.md`
  and the audit finding P0-FORCE-DYNAMIC (root cause RC-1 in
  `/root/.claude/plans/staff-melodic-oasis.md`).

## Context

`frontend/src/app/layout.tsx` declares `export const dynamic = "force-dynamic"`.
The comment in-file explains why:

> Render every route per-request so the CSP middleware's per-request nonce
> (`src/middleware.ts`) is applied to Next.js inline scripts. A statically
> prerendered page cannot carry a per-request nonce, which would leave the
> strict script-src blocking the framework's own bootstrap scripts.

The middleware (`frontend/src/middleware.ts`) generates a fresh nonce on every
request, sets it both in the **request** CSP header (Next.js reads it to
stamp into its inline bootstrap scripts) and the **response** CSP header
(the browser uses it to allow the nonced scripts). Production CSP is
`script-src 'self' 'nonce-{nonce}'` — *no* `'unsafe-inline'`.

This setup gives strong XSS resistance: any injected inline `<script>` is
blocked by the browser because it lacks the per-request nonce. The cost is
that every route is rendered per-request — Next.js's static optimisation is
disabled across the entire surface, TTFB pays for SSR on routes that have
no per-request data, and CDN cacheability of HTML is lost.

The audit flagged this as P0 with the recommendation to "remove the global;
verify every route renders without nonce-bound script; if a route ever does
need inline script, add `dynamic = 'force-dynamic'` at that segment."

## The fork in the road

Either the nonce stays (force-dynamic stays), or the nonce goes (CSP must
switch to **hashes** for inline framework scripts, or relax to
`'unsafe-inline'`). There is no third path within Next.js's current model:

- **Static prerender + per-request nonce**: not possible. Static HTML is
  baked at build time; the runtime CSP carries a fresh nonce that does not
  match the baked-in `nonce-XYZ` attribute. The browser blocks every
  framework script. Site is unusable.
- **Static prerender + hash-based CSP**: possible in theory. Next.js's inline
  framework scripts are deterministic per build; computing their SHA-256
  hash and inserting `'sha256-...'` into the CSP would let static HTML run
  with a strict CSP. In practice, Next.js does not expose a stable hash
  manifest (the hashes change on every build, and there is no first-class
  API to read them post-build); third-party plugins exist but are immature.
- **Static prerender + `'unsafe-inline'` for scripts**: trivially possible,
  trivially worse. Any injected `<script>` runs. This is the pre-CSP web.

## Decision

Keep the `force-dynamic` global **for now**, with a clear sunset condition.

The trade-off is conscious: we are paying TTFB and CDN cacheability to
preserve a nonce-only `script-src`, which is the strongest browser-side XSS
defence Next.js's runtime currently allows. The audit's recommendation to
ship per-route force-dynamic only on the routes that need it is correct in
spirit, but in this codebase **every** route needs Next.js framework
bootstrap scripts to run, and those scripts can only carry a nonce if the
HTML is rendered per-request. There is no static route exempt from the
constraint.

We will remove the global when **one** of the following ships:

1. **Hash-based CSP.** A build-time step that produces a stable manifest of
   the SHA-256 hashes of every inline framework script emitted by Next.js,
   feeds them into the middleware so the production CSP becomes
   `script-src 'self' 'sha256-...'` for the framework set plus an
   optional `'nonce-...'` for routes that need per-request inline. With
   hashes, static prerender works because the hash does not change per
   request.
2. **A future Next.js minor that publishes a first-class hash manifest API.**
   Tracking issue: [vercel/next.js#xxx] (placeholder — this ADR is updated
   when a concrete issue exists).
3. **A deliberate weakening to `'unsafe-inline'`** — explicitly rejected
   below.

Until then:

- `force-dynamic` stays in `layout.tsx`.
- The per-request nonce middleware stays.
- The `style-src 'unsafe-inline'` allowance documented in `middleware.ts`
  stays — Tailwind + Next.js inject critical CSS as inline `<style>` on
  SSR, and a nonce on `<style>` does not work without the same hash
  pipeline. The trade-off is documented as accepted in `middleware.ts`.
- The audit finding **P0-FORCE-DYNAMIC** is reclassified from "fix
  immediately" to **"open contingent on hash-CSP work"** in
  `docs/INVARIANTS.md` and the master plan; this ADR is the contingent.

## Consequences

### Positive

- Stable, currently-shipping security posture: nonce-only `script-src` with
  no `'unsafe-inline'` script allowance. The OWASP A07 (Injection) attack
  surface stays narrow.
- One CSP policy across the surface; no per-route exceptions to audit.
- No regression risk from a partial rollout: the alternative path (per-route
  force-dynamic) would require manually marking every route that uses any
  inline script generated by Next.js or by libraries — a class of bug that
  is silent until the CSP blocks production traffic.

### Negative

- Static optimisation is disabled across the entire app. Every route pays
  SSR cost even when its data is build-time-knowable.
- CDN HTML caching is unavailable. HTML cache hit ratio = 0.
- TTFB on cold-start regions includes the SSR latency for every navigation.
- Frontend bundle audit (T4.10) cannot rely on static HTML for any route.

These costs are accepted in exchange for the nonce-only `script-src`.

### Risk if violated

A contributor removing `force-dynamic` without first wiring hash-CSP would
ship a site that immediately fails to load: every Next.js inline bootstrap
script would be blocked by the production CSP. CI does not catch this
today because the production CSP is set by middleware at runtime, not
checked against build artefacts; a deliberate `playwright` smoke test on
the static-prerender output is the right tripwire and is tracked alongside
the eventual hash-CSP migration.

## Alternatives considered

### A. Remove `force-dynamic`; relax `script-src` to include `'unsafe-inline'`

Trivially possible. Trivially worse: any injected `<script>` runs. This
removes the primary CSP defence for an application whose threat model
includes XSS via user-generated content (todo titles, comments,
notification bodies are all rendered into the DOM).

**Rejected** as a regression in security posture.

### B. Per-route `force-dynamic`; mark only routes that need the nonce

The audit's recommendation. Engineering-wise correct, but in this codebase
the set of "routes that need the nonce" is the full set of routes — every
route boots the Next.js framework runtime, which emits inline scripts that
the production CSP only allows via the nonce. Per-route opt-in delivers
zero static routes, identical performance to the current global, and
adds a maintenance burden (every new route must be reviewed for "does
it touch any inline script?").

**Rejected** until the set of nonce-free routes is non-empty, which only
happens once hash-CSP lands.

### C. Hash-based CSP today, hand-rolled

Compute SHA-256 hashes of every inline script emitted by Next.js as part of
the build, feed them into the middleware. Possible but tightly coupled to
Next.js internals: every minor version that changes framework boot scripts
breaks the production CSP silently. The maintenance cost is real, and the
breakage mode (white-page on production deploys) is unacceptable for a
single-maintainer project.

**Rejected** until either Next.js exposes a stable manifest, or a vetted
community plugin (e.g. `next-safe`, `@next/csp`) reaches a stability level
the codebase is willing to depend on.

### D. Edge runtime with selective static prerender + middleware-only CSP

Next.js edge runtime can serve static HTML and apply the CSP from the
middleware. The static HTML still cannot carry a per-request nonce in its
inline-script attributes. Same blocker as the trivial static case.

**Rejected** for the same reason as A. Edge runtime is orthogonal to the
nonce problem.

## References

- `frontend/src/app/layout.tsx:29` — the `force-dynamic` global.
- `frontend/src/middleware.ts` — the per-request nonce pipeline.
- `docs/INVARIANTS.md` — INV-CSP family (if added by a follow-up).
- Audit finding P0-FORCE-DYNAMIC in
  `/root/.claude/plans/staff-melodic-oasis.md` (RC-1 + T2.7).
- ADR-0003 (CSRF double-submit) — different attack surface, same
  "documented intentional trade-off" pattern.
