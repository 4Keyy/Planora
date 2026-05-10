# FAQ

## General

### What is Planora?

A personal productivity web app with tasks, categories, account security, friendship-based sharing, direct messages, and realtime notification primitives.

### Is it a monolith?

No. The backend is split into Auth, Todo, Category, Messaging, Realtime, and API Gateway projects. Shared primitives live under `BuildingBlocks`.

### Is there a public production deployment guide?

Yes, there is now a production baseline in [`production.md`](production.md) and secret handling in [`secrets-management.md`](secrets-management.md). A concrete hosting target and deployment automation are still not committed.

## Setup

### Which URL should the frontend call?

Use the API Gateway: `http://localhost:5132`. The frontend defaults to that in `frontend/next.config.js`.

### Why is PostgreSQL on port `5433`?

`docker-compose.yml` maps container port `5432` to host `127.0.0.1:5433`, probably to avoid collisions with a local PostgreSQL install.

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

### Do I need to update Graphify?

Yes after substantial code, config, dependency, test, or documentation changes. Project instructions require graph rebuilds.

### Should AI assistant settings be committed?

No. Repository policy ignores Claude/Codex/Cursor/Gemini/MCP and similar local assistant state. `AGENTS.md` is the intentional project-level exception for shared Graphify and documentation rules; use `AGENTS.local.md` for personal or machine-specific instructions.

### Are EF migrations committed?

No. Generated `Migrations/` folders are ignored by repository policy. Clean local/Docker installs create schema from the current EF model if no user-owned migrations exist. Production owners should generate and manage migrations in their deployment branch/environment when auditable schema evolution is required.

### Is there e2e browser testing?

There is Playwright e2e coverage for the critical gateway/service flow in `frontend/e2e/auth-todos-sharing-hidden.api.spec.ts`. It is API-level Playwright, not browser-rendered UI navigation. Frontend component/page tests remain Vitest-based.

### How do I report a security issue?

Use GitHub Private Vulnerability Reporting as described in [`../SECURITY.md`](../SECURITY.md). Do not open a public issue for exploitable vulnerabilities.

### What license does the project use?

The repository includes an MIT [`../LICENSE`](../LICENSE).

## Documentation

### Why does `docs/API.md` use uppercase?

The existing project had `docs/API.md`. On Windows a case-only rename to `api.md` can be noisy; this documentation pass keeps the existing file path and updates links consistently.

### What should I update when I change an endpoint?

Update the controller tests, frontend API consumers if needed, `docs/API.md`, `docs/features.md`, and any affected configuration/security/testing docs.
