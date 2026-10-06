# FAQ

## General

### What is Planora?

A personal productivity web app with tasks, categories, account security, friendship-based sharing, direct messages, and realtime notification primitives.

### Is it a monolith?

No. The backend is split into Auth, Todo, Category, Collaboration, Messaging, Realtime, and API Gateway projects. Shared primitives live under `BuildingBlocks`.

### Is there a public production deployment guide?

Yes. The production target is **Fly.io**; the per-app manifests live in
[`../deploy/fly/`](../deploy/fly/), the CD workflow at
[`.github/workflows/cd.yml`](../.github/workflows/cd.yml), and the
zero-to-deployable walkthrough in
[`deployment.md`](deployment.md) "Bootstrap workflow — zero to deployable
in three commands". Migration governance is centralized in
[`tools/Planora.Migrator/`](../tools/Planora.Migrator/).

Production activation also requires resolving the [confirmed rollout blockers](deployment.md#confirmed-rollout-blockers), configuring actual service addresses/ports and choosing frontend hosting. Optional telemetry exporters remain disabled without their endpoints; core database/broker/JWT requirements are not optional.

## Setup

### Which URL should the frontend call?

Use the API Gateway: `http://localhost:5132`. The frontend defaults to that in `frontend/next.config.js`.

### Why is PostgreSQL on port `5433`?

`docker-compose.yml` explicitly maps container port `5432` to host `127.0.0.1:5433`. Use 5433 from host tools and 5432 inside the Compose network.

### Can I run only the frontend?

Yes, but it needs a running gateway/backend for real data:

```powershell
npm --prefix frontend run dev
```

### Can I run backend services locally instead of in Docker?

Yes. Use:

```powershell
.\Start-Planora-Local.ps1
```

It starts infrastructure in Docker and .NET services on the host.

## Auth And Security

### Where is the refresh token stored?

In an httpOnly `refresh_token` cookie scoped to `/auth/api/v1/auth`; the frontend cannot read it.

### Does the frontend store access tokens in localStorage?

No. `frontend/src/store/auth.ts` keeps the access token in memory and persists user metadata/expiry timestamps in session storage.

### Why do auth POST requests need CSRF?

Because the browser automatically sends the refresh cookie. The CSRF header proves frontend JavaScript could read the separate `XSRF-TOKEN` cookie.

### Are roles implemented?

Yes. `Admin` and `User` roles are seeded in Auth persistence, and selected endpoints require `Admin`.

## Todos

### What statuses exist?

Backend statuses are `Todo`, `InProgress`, and `Done`. The parser accepts some legacy aliases such as `pending` and `completed`.

### Can a shared viewer edit the whole todo?

No. A non-owner shared viewer can only change status.

### Why does a hidden shared todo show `Hidden task`?

That is intentional server-side redaction. The backend hides sensitive fields for hidden shared/public tasks.

### Can hidden shared tasks still be filtered by category?

Yes. Redacted DTOs preserve viewer category metadata so filters can still work.

## Development

### Where do I add a new backend feature?

Inside the owning service. Add Application command/query/handler/validator, Domain changes if needed, Infrastructure changes if needed, then API controller/gateway route if browser-facing.

### Where do I add frontend API behavior?

Use `frontend/src/lib/api.ts` for authenticated API behavior and `frontend/src/lib/auth-public.ts` for auth bootstrap/refresh calls that must avoid interceptor recursion.

### Should AI assistant settings be committed?

No. Repository policy ignores Claude/Codex/Cursor/Gemini/MCP and similar local assistant state. `AGENTS.md` is also ignored and untracked in this checkout; tracked contributor rules are in `CONTRIBUTING.md` and `docs/development.md`.

### Are EF migrations committed?

Todo and Realtime have tracked migrations; generated migration paths are nevertheless ignored for new untracked files. Auth, Category, Collaboration and Messaging currently use model bootstrap when no local migrations are compiled. The tracked Todo chain is missing its initial baseline, and Realtime needs explicit schema initialization. See [Database](database.md).

### Is there e2e browser testing?

Yes. Playwright has an API project for `auth-todos-sharing-hidden.api.spec.ts` and a Chromium UI project under `frontend/e2e/ui`. UI specs cover auth routes, profile and tasks. CI builds/starts the frontend plus Compose stack. See [Testing](testing.md) for setup, scope and measured results.

### How do I report a security issue?

Use GitHub Private Vulnerability Reporting as described in [`../SECURITY.md`](../SECURITY.md). Do not open a public issue for exploitable vulnerabilities.

### What license does the project use?

A deliberately restrictive **source-available, study-only** license — see
[`../LICENSE`](../LICENSE). You may read the code and run a personal copy
on your own machine to learn from it. You may **not** use it in any
product, service, fork, redistribution, container image, hosted
deployment, AI training corpus, or any other software — public or
private, commercial or non-commercial. Any other use requires prior
written permission from the copyright holder.

### Are CSRF checks needed on Todo / Category / Messaging / Realtime?

The Auth-only scope recorded in [ADR-0005](DECISIONS/0005-csrf-coverage-bounded-to-auth-api.md) is not the current registration. Auth, Todo, Category, Messaging and Collaboration register `UseCsrfProtection`; Realtime and gateway do not. The frontend sends a token header on mutations. See [Auth security](auth-security.md) for exclusions and actual validation behavior.

### How do I turn on traces / metrics / logs in production?

Set the relevant environment variable on every Fly.io app and restart:

- `OTEL_EXPORTER_OTLP_ENDPOINT` (and `OTEL_EXPORTER_OTLP_HEADERS` for
  Grafana Cloud auth) — activates OpenTelemetry traces + metrics.
- `LOKI_URL` (with `LOKI_USER` / `LOKI_TOKEN`) — activates centralized
  logs.

No code change is required; the pipelines are no-op without these. See
[`observability.md`](observability.md) for the full walkthrough.

### How do I know production is ready to deploy from this checkout?

Run `.\scripts\Verify-Phase1-Prereqs.ps1`. It checks flyctl auth, every
Fly app's existence and required secret set, the local
`dotnet build -warnaserror` state, and the `FLY_API_TOKEN` GitHub
repository secret. Exit code counts failed checks; `0` means only those limited checks passed. The script applies the same common secret list to all apps, misses service DB requirements and does not validate Docker build graphs, source tests, listener ports or gateway production routes. Use [Production acceptance](production.md) as the release checklist.

## Documentation

### Why does `docs/API.md` use uppercase?

The existing project had `docs/API.md`. On Windows a case-only rename to `api.md` can be noisy; this documentation pass keeps the existing file path and updates links consistently.

### What should I update when I change an endpoint?

Update the controller tests, frontend API consumers if needed, `docs/API.md`, `docs/features.md`, and any affected configuration/security/testing docs.
