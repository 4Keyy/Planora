# Security Audit — June 2026

Full-project security audit of Planora: threat surface, architecture, and code.
This document records every confirmed finding, the fixes applied in this pass, and
the items that were investigated and deliberately left unchanged (with rationale),
so reviewers do not "re-fix" accepted trade-offs.

## Scope

- Auth service (auth, sessions, tokens, 2FA, friendships)
- Business services (Todo, Category, Messaging, Collaboration, Realtime) and gRPC contracts
- API Gateway (Ocelot) and shared BuildingBlocks
- Next.js frontend
- Infrastructure and CI/CD (Docker, Fly, GitHub Actions)

Methodology: five parallel domain audits, then per-finding manual verification of the
code before any change. Findings that turned out to be false positives are listed so the
reasoning is preserved.

## Overall posture

The codebase is mature. Strong, correctly-implemented controls already in place include:

- PBKDF2-SHA512 password hashing (100k iterations, per-password salt, constant-time verify).
- Refresh-token rotation with reuse detection and per-user security stamp revocation.
- TOTP 2FA with Redis replay-prevention and recovery codes.
- JWT validation everywhere (issuer/audience/lifetime/signing key, 30s clock skew, HS256 pinned).
- CSRF double-submit with timing-safe comparison; access token kept in frontend memory,
  refresh token in a path-scoped `HttpOnly; Secure; SameSite=Strict` cookie.
- Per-user/per-IP rate limiting that is not bypassable via spoofed `X-Forwarded-For`
  (forwarded headers are opt-in and gated on configured known proxies).
- gRPC service-to-service auth with a shared key compared in constant time.
- Strict security headers, log sanitization (CR/LF/control stripping), and generic 5xx errors.
- Non-root containers, SHA-pinned actions, gitleaks + CodeQL + Trivy, SBOM with Sigstore
  attestation, internal-only Fly services.

## Findings fixed in this pass

### 1. Comment update missing task-access authorization (IDOR/BOLA) — High

`UpdateCommentCommandHandler` checked only comment authorship (inside `Comment.UpdateContent`)
and, unlike the Add/Delete/Get handlers, never called `ITaskAccessService.CheckCommentAccessAsync`.
A user who authored a comment but later lost access to the parent task (e.g. a share was revoked)
could still edit that comment.

Fix: the handler now resolves live task access via gRPC to TodoApi and returns
`404` when the task is not visible / `403` when access is denied, before editing. Added a
unit test (`UpdateComment_AuthorWithoutTaskAccess_ThrowsForbidden`).

### 2. CSRF enforcement only on AuthApi — Medium (defense-in-depth)

The documented security model requires a double-submit CSRF token on browser state-changing
requests, but `UseCsrfProtection()` was wired only into AuthApi. Business services authenticate
with a bearer token (not an ambient cookie), so they were not classically CSRF-exploitable, but
the inconsistency diverged from the stated model.

Fix: `UseCsrfProtection()` added after authentication in Todo, Category, Messaging, and
Collaboration. The frontend already sends `X-CSRF-Token` on every POST/PUT/DELETE/PATCH through
the gateway, and the middleware exempts internal gRPC (`application/grpc` over HTTP/2), so no
legitimate traffic breaks. Realtime is intentionally excluded — its only mutating surface is the
SignalR negotiate POST, which does not carry the CSRF header and is bearer-authenticated.

### 3. Account-lockout values hardcoded and inconsistent — Medium

`User.LockAccount()` hardcoded a 15-minute lockout while `SecurityConstants.SecurityPolicies`
defined `AccountLockoutMinutes = 30` and `MaxFailedLoginAttempts = 5`; `UserRepository` separately
hardcoded the `>= 5` threshold. The documented policy was not the one actually enforced.

Fix: `LockAccount(int lockoutMinutes)` is now parameterized (and rejects non-positive values),
and `UserRepository` drives both the threshold and the duration from
`SecurityConstants.SecurityPolicies`. Single source of truth restored.

### 4. PresenceHub broadcast of unvalidated client string — Low

`PresenceHub.UpdateStatus(string status)` rebroadcast an arbitrary, unbounded client-supplied
string to all other connected clients (an amplification vector). The hub is not currently mapped,
but the method was hardened anyway.

Fix: `status` is validated against an allow-list (`online`/`away`/`busy`/`offline`) and rejected
with `HubException` otherwise.

## Investigated and intentionally left unchanged

- **Messaging conversation "IDOR"** — reported as readable cross-user conversations. Not a
  vulnerability: the controller binds the first participant to `ICurrentUserContext.UserId` from
  the JWT, so a caller can only read conversations they participate in. No change.
- **Unencrypted HTTP/2 (h2c) for gRPC** (`Http2UnencryptedSupport` switch) — required for the
  cleartext-h2c gRPC clients, which run over Fly's WireGuard-encrypted private mesh. Disabling it
  would break production service-to-service calls without adding real confidentiality. No change.
- **PBKDF2 iteration count (100k)** — acceptable for PBKDF2-SHA512. Cannot be raised safely without
  a rehash-on-login migration, since the stored hash encodes no iteration count; bumping the
  constant would invalidate every existing password. Left for a coordinated migration.
- **Registration returns 409 on duplicate email** — enables limited account enumeration, but the
  endpoint is rate-limited (3/min) and hiding it materially degrades signup UX. Accepted trade-off.
- **Access-token lifetime 60m in Docker vs 15m in dev** — within industry norms; revocation is
  handled by refresh rotation + security stamp. Configuration choice, not a flaw.
- **Dev/local default DB credentials in committed `appsettings*.json` and `launchSettings.json`** —
  localhost-only convenience values; real environments inject secrets via env vars / Fly secrets,
  and docker-compose overrides the connection string entirely. Low risk; left to avoid breaking
  local onboarding. Operators must continue to supply strong secrets in every non-dev environment.
- **k6 GPG key installed via `curl | gpg` in perf-smoke CI / test `postgres/postgres` in CI** —
  ephemeral, localhost-only CI containers; low real risk. Candidate for future hardening
  (pin the key fingerprint, generate random CI passwords) but not a deployed exposure.
- **SignalR token via query string / dev-only `unsafe-eval` CSP / analytics bearer to own backend** —
  reviewed; these are framework requirements or first-party authenticated calls, not leaks.

## Recommended follow-ups (not code changes)

- Pin the k6 signing-key fingerprint and generate random CI database passwords.
- Add a CSP `report-to`/`report-uri` endpoint to gain visibility into violations.
- Document the production requirement to set `ForwardedHeaders:KnownProxies` to the edge range.
- Plan a PBKDF2 rehash-on-login path so the iteration count can be raised over time.
