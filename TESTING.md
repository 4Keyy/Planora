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

## CI

`.github/workflows/ci.yml` runs markdown lint/link checks, backend restore/build/test, and frontend lint/type-check/test/build.

`.github/workflows/e2e.yml` runs Docker-backed Playwright e2e for auth/todos/sharing/hidden.

`.github/workflows/security.yml` runs Gitleaks, NuGet vulnerability checks, and npm audit.

See [`docs/testing.md`](docs/testing.md) for coverage details, manual QA, and recommended tests for new changes.
