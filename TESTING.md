# Testing

This root file is the short test summary. The full guide is [`docs/testing.md`](docs/testing.md).

## Backend

```powershell
dotnet restore Planora.sln
dotnet build Planora.sln
dotnet test Planora.sln --settings coverage.runsettings
```

Test projects:

- `tests/Planora.UnitTests`
- `tests/Planora.ErrorHandlingTests`

Current Todo handler coverage includes public friend tasks without direct share rows, viewer preferences, and limited non-owner status updates.

Coverage settings:

- `coverage.runsettings`

## Frontend

```powershell
Push-Location frontend
npm install
Pop-Location
npm --prefix frontend run lint
npm --prefix frontend run type-check
npm --prefix frontend run test
npm --prefix frontend run test:coverage
npm --prefix frontend run build
```

Frontend test config:

- `frontend/vitest.config.ts`
- `frontend/src/test`

Current frontend coverage includes authenticated navbar menu interactions, Todo author-name enrichment for public friend tasks, hidden-card category blur, urgency border styling, and all-friends sharing inside `Share With`.

## E2E

```powershell
docker compose --env-file .env up -d --build
npm --prefix frontend run e2e
```

E2E config:

- `frontend/playwright.config.ts`
- `frontend/e2e/auth-todos-sharing-hidden.api.spec.ts`
- `.github/workflows/e2e.yml`

## Load / Performance (k6)

On-demand load scenarios live in `perf/k6/` (helpers in `lib/`, scenarios in `scenarios/`). Run any scenario against a running Docker stack:

```powershell
docker compose --env-file .env up -d --build
k6 run perf/k6/scenarios/todo-list.js -e API_BASE_URL=http://127.0.0.1:5132
```

See [`perf/README.md`](perf/README.md) for thresholds, baselines, and CI integration via `.github/workflows/perf-smoke.yml` (manual dispatch).

## CI

`.github/workflows/ci.yml` runs markdown lint/link checks, backend restore/build/test, and frontend lint/type-check/test/build.

`.github/workflows/e2e.yml` runs Docker-backed Playwright e2e for auth/todos/sharing/hidden.

`.github/workflows/security.yml` runs Gitleaks (with Planora-specific rules in `.gitleaks.toml`), CodeQL SAST, Trivy IaC scanning, NuGet vulnerability checks, npm audit, and a CycloneDX SBOM artifact job.

`.github/workflows/migrations.yml` attaches a per-service idempotent SQL migration script as a 30-day PR artifact whenever schema-relevant paths change.

`.github/workflows/perf-smoke.yml` runs the k6 scenarios on demand against the full Docker stack.

See [`docs/testing.md`](docs/testing.md) for coverage details, manual QA, and recommended tests for new changes.
