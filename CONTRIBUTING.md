# Contributing

Thanks for improving Planora. This repository has several service boundaries, so changes should be small, traceable, and documented.

## Before You Change Code

1. Read `graphify-out/GRAPH_REPORT.md`.
2. Use `graphify-out/wiki/index.md` to find the relevant service/community.
3. Read only the raw files needed for the change.
4. Check the relevant docs:
   - [`docs/architecture.md`](docs/architecture.md)
   - [`docs/codebase-map.md`](docs/codebase-map.md)
   - [`docs/development.md`](docs/development.md)
   - [`docs/testing.md`](docs/testing.md)

## Local Setup

```powershell
Copy-Item .env.example .env
# edit required secrets
.\Start-Planora-Local.ps1
```

Docker backend mode:

```powershell
.\Start-Planora-Docker.ps1
```

## Required Checks

Run the checks relevant to your change:

```powershell
dotnet build Planora.sln
dotnet test Planora.sln --settings coverage.runsettings
npm --prefix frontend run lint
npm --prefix frontend run type-check
npm --prefix frontend run test
```

For frontend production-impacting changes, also run:

```powershell
npm --prefix frontend run build
```

For auth/todos/sharing/hidden-flow changes, run the Docker-backed e2e suite:

```powershell
docker compose --env-file .env up -d --build
npm --prefix frontend run e2e
```

For documentation changes, CI runs markdownlint and offline link checks. Run local equivalents if the tools are installed:

```powershell
npx markdownlint-cli2 README.md CHANGELOG.md CONTRIBUTING.md SECURITY.md TESTING.md ARCHITECTURE.md "docs/**/*.md"
```

## Change Guidelines

- Keep service ownership intact. Do not query another service's database directly.
- Use existing CQRS/MediatR, FluentValidation, Result, repository, and DTO patterns.
- Add tests for behavior, not just implementation details.
- Update docs when changing routes, config, DB schema, security behavior, launch scripts, tests, or UI workflows.
- Update production and secret-management docs when changing deployment assumptions or secret names.
- Mark uncertain behavior as "requires owner clarification" instead of documenting assumptions.
- Do not commit `.env`, secrets, logs, build outputs, coverage outputs, `.next`, `bin`, `obj`, or `node_modules`.

## Pull Request Checklist

- [ ] Change is scoped to one clear behavior or documentation area.
- [ ] Backend build/tests pass if backend changed.
- [ ] Frontend lint/type-check/tests pass if frontend changed.
- [ ] Playwright e2e passes if auth/todos/sharing/hidden behavior changed.
- [ ] Markdown docs checks pass if docs changed.
- [ ] API docs updated for route/DTO/status changes.
- [ ] Database docs updated for EF/schema changes.
- [ ] Security docs updated for auth/session/CSRF/JWT/CORS changes.
- [ ] Production/secret docs updated for deployment or secret changes.
- [ ] Graphify has been rebuilt after substantial code/config/test/docs changes.
- [ ] No secrets or generated artifacts are included.

## Security Reports

Do not file public issues for exploitable vulnerabilities. Use the process in [`SECURITY.md`](SECURITY.md).

## Documentation Index

Use [`docs/index.md`](docs/index.md) as the documentation map.
