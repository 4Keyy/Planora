# Playwright E2E

Two projects in [`playwright.config.ts`](../playwright.config.ts) share this
folder. The config does not start servers; prepare the stack before running tests.

| Project | File pattern | Driver | Required service |
|---|---|---|---|
| `api` | `*.api.spec.ts` | `APIRequestContext`, no browser | Gateway at `E2E_API_URL`, default `http://127.0.0.1:5132`, plus backend dependencies |
| `ui` | `*.ui.spec.ts` | Desktop Chrome / Chromium | Next.js at `E2E_FRONTEND_URL`, default `http://127.0.0.1:3000`, plus gateway/backend stack |

The suite runs with one worker, `fullyParallel: false`, a 90-second test timeout,
10-second expectation timeout and two retries on CI (zero locally). Failure
traces, screenshots and video go to `test-results/playwright`; the HTML report
goes to `playwright-report`.

## Local setup on Windows

Commands below start from the repository root. Use separate PowerShell terminals
for the server and test runner. Reuse your existing local environment file; do
not overwrite it with sample values. See the root
[getting-started guide](../../docs/getting-started.md) for local configuration.

Terminal 1 — backend:

```powershell
docker compose --env-file .env up -d --build
docker compose --env-file .env ps
Invoke-WebRequest http://127.0.0.1:5132/health
```

Terminal 2 — frontend:

```powershell
npm ci --prefix frontend
Push-Location frontend
npx playwright install --with-deps chromium # first run / after Playwright upgrade
Pop-Location
$env:NEXT_PUBLIC_API_URL = "http://127.0.0.1:5132"
npm --prefix frontend run build
npm --prefix frontend run start
```

Use a production build for production CSP/chunk/hydration behavior. Development
mode has different HMR and rendering timing. A build replaces its output directory;
do not build into the directory a running production server is serving.

Terminal 3 — tests:

```powershell
$env:E2E_API_URL = "http://127.0.0.1:5132"
$env:E2E_FRONTEND_URL = "http://127.0.0.1:3000"
$env:E2E_AUTH_LOG_CONTAINER = "planora-auth-api"
npm --prefix frontend run e2e

# Or choose a project / one browser spec:
npm --prefix frontend run e2e -- --project=api
npm --prefix frontend run e2e -- --project=ui
npm --prefix frontend run e2e -- --project=ui auth-login.ui.spec.ts
npm --prefix frontend run e2e:report
```

Tests register disposable users and create persistent test data in the selected
stack. Use an isolated development/e2e stack. A successful test does not clean
every created account/task out of a shared database.

## Authentication fixtures and skip behavior

[`ui/_helpers.ts`](ui/_helpers.ts) registers users through the API, obtains a CSRF
cookie/header pair, and reads verification/reset links from the Auth container's
development log-email provider. It does not read production mailboxes.

| Setting | Default | Meaning |
|---|---|---|
| `E2E_API_URL` | `http://127.0.0.1:5132` | Gateway for API setup and API project |
| `E2E_FRONTEND_URL` | `http://127.0.0.1:3000` | Browser target and frontend reachability probe |
| `E2E_AUTH_LOG_CONTAINER` | `planora-auth-api` | Container whose development email logs contain fixture tokens |
| `E2E_VERIFY_EMAIL_FROM_LOGS` | enabled unless exactly `false` | Controls verification-from-logs setup; token/verified-user flows cannot be treated as complete with it disabled |

UI files call `requireFrontendReachable()` before running. An unreachable frontend
or a response ≥500 skips the file; the helper does not prove that the complete
frontend/backend stack is healthy. Reset/verification tests also have token-log
requirements. Check passed, failed **and skipped** totals and the process exit
code; a skipped browser suite is not evidence that browser behavior passed.

## Scope of the suites

The API spec covers registration, email verification, friendship creation,
categories, shared tasks and viewer-specific hide/reveal through the gateway.
Tracked UI specs cover login, registration, password recovery, email verification,
profile rename and task-page entry/create-panel reachability. They do not cover
every branch reply, ownership, realtime reconnect, accessibility or responsive state.

At the 2026-10-06 audit, `ui/motion-geometry.ui.spec.ts` was present as a local
untracked regression suite for create-panel focus, card controls and navbar
geometry. It is discovered locally by the same UI pattern, but is not part of a
clean checkout or CI until tracked. Documentation review did not add that file.

The separate [`docs/ui-audit`](../../docs/ui-audit/) scripts use fixture-backed
browser routes. Their visual measurements complement these tests and do not
replace real-service end-to-end checks. See
[`docs/testing.md`](../../docs/testing.md) for coverage scopes and dated results.

## CI

[`.github/workflows/e2e.yml`](../../.github/workflows/e2e.yml) starts Docker, waits
for configured health endpoints, installs Chromium, builds/starts Next.js and runs
both projects on relevant pull requests or manual dispatch. It uploads the report
and test artifacts, then stops the frontend and containers. The workflow's browser
cache behavior is defined by its actual steps; npm caching alone does not prove
that downloaded browser binaries are cached.
