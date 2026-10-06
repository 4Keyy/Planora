# Testing

This root file is the short test summary. The full guide is [`docs/testing.md`](docs/testing.md).

## Backend

```powershell
dotnet restore Planora.sln
dotnet build Planora.sln
dotnet test Planora.sln --collect:"XPlat Code Coverage" --settings coverage.runsettings
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
npm ci
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

The V8 gate is ≥85% statements, branches, functions and lines for its included
scope. It excludes route pages and the full `edit-todo-modal` subtree; a passing
percentage does not establish coverage for those excluded paths.

The final 2026-10-06 frontend run at `b2e9c70` passed 100 files / 1,231 tests,
with 86.46% branch coverage and all four configured thresholds above 85%.
Lint, type check and the isolated production build also passed. The publication
follow-up corrected two stale password-reset URL expectations to
`/auth/reset-password` and patched the XML cryptography dependency. A forced
restore, Release build with `-warnaserror` and all 972 backend tests passed.
The [dated report](docs/audits/2026-10-06.md) records the initial failures,
subsequent corrections and practical limits. Four motion/geometry browser tests
were discovered but skipped because the local frontend was unreachable.

## E2E

```powershell
docker compose --env-file .env up -d --build
npm --prefix frontend run e2e
```

Playwright has `api` (gateway HTTP) and `ui` (Chromium) projects. The latter
needs a separately built/running Next.js server; configuration does not launch
it. A UI file may skip when the frontend is unreachable. Follow
[`frontend/e2e/README.md`](frontend/e2e/README.md) and inspect skipped tests.

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

`.github/workflows/e2e.yml` starts Docker and a production Next.js frontend and
runs both API and UI Playwright projects.

`.github/workflows/security.yml` runs Gitleaks (with Planora-specific rules in `.gitleaks.toml`), CodeQL SAST, Trivy IaC scanning, NuGet vulnerability checks, npm audit, and a CycloneDX SBOM artifact job.

`.github/workflows/migrations.yml` attaches idempotent SQL artifacts for all six
DB-owning services after restore/Release build with EF CLI 10.0.8.
`.github/workflows/openapi.yml` generates six configured
service contracts, including Collaboration's HTTP API. Metadata extraction is
separate from validating startup or applying the generated migration scripts.

`.github/workflows/perf-smoke.yml` runs the k6 scenarios on demand against the full Docker stack.

See [`docs/testing.md`](docs/testing.md) for coverage details, manual QA, and recommended tests for new changes.
