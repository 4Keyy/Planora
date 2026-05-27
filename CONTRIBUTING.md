# Contributing

> **License notice — read this first.** Planora is published under a deliberately restrictive **source-available, study-only license** (see [`LICENSE`](LICENSE)). Submitting a pull request is permitted, and by submitting one you grant the copyright holder a perpetual, worldwide, royalty-free, non-exclusive license to use, modify, sublicense, and relicense your contribution on the same terms as the rest of the Software. Forking publicly, redistributing, deploying, or otherwise using Planora outside personal study is **not** permitted by the license.

Thanks for improving Planora. This repository has several service boundaries, so changes should be small, traceable, and documented.

## Before You Change Code

1. Read only the raw files needed for the change.
2. Check the relevant docs:
   - [`docs/INVARIANTS.md`](docs/INVARIANTS.md) — closed-form architectural invariants; a PR that breaks one of these is rejected on sight.
   - [`docs/architecture.md`](docs/architecture.md)
   - [`docs/codebase-map.md`](docs/codebase-map.md)
   - [`docs/development.md`](docs/development.md)
   - [`docs/testing.md`](docs/testing.md)
3. Code style is governed by [`.editorconfig`](.editorconfig) (charset, EOL, indentation, security-relevant analyzer severities). Your editor should pick it up automatically; the backend build also runs under `-warnaserror` via [`Directory.Build.props`](Directory.Build.props).

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

### Optional — Install pre-commit hooks

A one-shot per-clone setup installs ESLint (frontend) and `dotnet format`
(backend) gates so style and basic-lint regressions never reach CI:

```bash
./scripts/install-hooks.sh
```

The script sets `git config core.hooksPath .githooks` for the current
working clone — nothing global is changed. Bypass for an emergency commit
with `git commit --no-verify`. Disable with `git config --unset
core.hooksPath`. The gates only run on the files actually staged; a
no-op commit is instant.

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
- [ ] No invariant in [`docs/INVARIANTS.md`](docs/INVARIANTS.md) is violated; if a rule needs to change, the rule and the code change ship in the same PR.
- [ ] Backend build/tests pass if backend changed (`dotnet build -warnaserror` is clean).
- [ ] Frontend lint/type-check/tests pass if frontend changed.
- [ ] Playwright e2e passes if auth/todos/sharing/hidden behavior changed.
- [ ] If the change touches an entity, EF configuration, DbContext, persistence layer, the migrator, or `Directory.Packages.props`, the `migrations` workflow attached the per-service idempotent SQL artifact and the diff was reviewed.
- [ ] Markdown docs checks pass if docs changed.
- [ ] API docs updated for route/DTO/status changes.
- [ ] Database docs updated for EF/schema changes.
- [ ] Security docs updated for auth/session/CSRF/JWT/CORS changes.
- [ ] Observability surface (custom counters, new ActivitySources, new Meters) added to `PlanoraMetrics` if cross-cutting; otherwise documented in the service-local module — cardinality budget audited.
- [ ] Production/secret/Fly.io docs updated for deployment or secret changes.
- [ ] No secrets or generated artifacts are included.

## Security Reports

Do not file public issues for exploitable vulnerabilities. Use the process in [`SECURITY.md`](SECURITY.md).

## Documentation Index

Use [`docs/index.md`](docs/index.md) as the documentation map.
