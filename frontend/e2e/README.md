# Playwright E2E

Two projects in [`playwright.config.ts`](../playwright.config.ts) share this
folder. The config does not start servers; prepare the stack before running tests.

| Project | File pattern | Driver | Required service |
|---|---|---|---|
| `api` | `*.api.spec.ts` | `APIRequestContext`, no browser | Gateway at `E2E_API_URL`, default `http://127.0.0.1:5132`, plus backend dependencies |
| `ui` | `*.ui.spec.ts` | Desktop Chrome / Chromium | Next.js at `E2E_FRONTEND_URL`, default `http://127.0.0.1:3000`, plus gateway/backend stack |

The suite runs with one worker, `fullyParallel: false`, a 180-second test timeout,
10-second expectation timeout and two retries on CI (zero locally). Auth setup
respects one `Retry-After` cooldown before retrying a rate-limited request;
production rate limits remain unchanged. Failure screenshots go to
`test-results/playwright`; trace and video recording are disabled. Local HTML
reports in `playwright-report` are private and may contain disposable credentials
or action links. Do not publish them.

## Local setup on Windows

Use a disposable checkout on a dedicated machine or runner with no existing
Planora stack. These tests create accounts and persist fixture data. The base
Compose file has fixed container names and host ports: a different `-p` project
name alone does not isolate it. If a stack is already running on this machine,
ask its owner for coordinated overrides before starting anything; do not reuse
its environment file, containers, volumes, servers or real credentials.

Commands below start from that disposable repository root. Use separate
PowerShell terminals for the server and test runner. Create a fresh `.env.e2e`
from `.env.example`, configuring fresh fixture values for the required database,
Redis, RabbitMQ, JWT and service-key settings. Generate the mandatory SMTP
password in the backend terminal without printing it:

```powershell
if (Test-Path -LiteralPath '.env.e2e') {
    throw 'Choose a fresh disposable checkout before creating E2E configuration.'
}
Copy-Item -LiteralPath '.env.example' -Destination '.env.e2e'
# Configure fresh fixture credentials in .env.e2e before starting the stack.
$e2eSmtpBytes = New-Object byte[] 32
$e2eSmtpRng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try { $e2eSmtpRng.GetBytes($e2eSmtpBytes) } finally { $e2eSmtpRng.Dispose() }
$env:E2E_SMTP_PASSWORD = ([BitConverter]::ToString($e2eSmtpBytes)).Replace('-', '').ToLowerInvariant()
```

Terminal 1 — backend:

```powershell
docker compose --env-file .env.e2e -f docker-compose.yml -f frontend/e2e/docker-compose.http.yml up -d --build
docker compose --env-file .env.e2e -f docker-compose.yml -f frontend/e2e/docker-compose.http.yml ps
Invoke-WebRequest http://127.0.0.1:5132/health
Invoke-WebRequest http://127.0.0.1:8025/livez
```

`docker-compose.http.yml` is the disposable HTTP/SMTP test overlay: it allows
Auth cookies over loopback HTTP, adds the local browser origins to gateway CORS,
and configures Auth to send real SMTP mail to Mailpit. The Mailpit v1.31.4 image
is pinned by digest, its API is published only at `127.0.0.1:8025`, and SMTP is
not published to the host. SMTP authenticates with the random fixture password;
plaintext transport is limited to this disposable test network. The sink has
no configured external relay. Production cookie defaults, CSRF validation and
rate limits remain unchanged; this overlay is not a deployment configuration.
Fixture names use alphabetic text to satisfy the registration validator.

Terminal 2 — frontend:

```powershell
npm ci --prefix frontend
Push-Location frontend
npx playwright install --with-deps chromium # first run / after Playwright upgrade
Pop-Location
$env:NEXT_PUBLIC_API_URL = "http://127.0.0.1:5132"
$env:NEXT_DIST_DIR = ".next-e2e"
npm --prefix frontend run build
npm --prefix frontend run start -- -p 3000
```

Use a production build for production CSP/chunk/hydration behavior. Development
mode has different HMR and rendering timing. A build replaces its output directory;
do not build into the directory a running production server is serving.

Terminal 3 — tests:

```powershell
$env:E2E_API_URL = "http://127.0.0.1:5132"
$env:E2E_FRONTEND_URL = "http://127.0.0.1:3000"
$env:E2E_MAILPIT_URL = "http://127.0.0.1:8025"
npm --prefix frontend run e2e

# Or choose a project / one browser spec:
npm --prefix frontend run e2e -- --project=api
npm --prefix frontend run e2e -- --project=ui
npm --prefix frontend run e2e -- --project=ui auth-login.ui.spec.ts
npm --prefix frontend run e2e:report
```

After the run, stop the frontend in its terminal, then stop only the disposable
stack using the same backend terminal and configuration:

```powershell
docker compose --env-file .env.e2e -f docker-compose.yml -f frontend/e2e/docker-compose.http.yml down --remove-orphans
Remove-Item -LiteralPath '.env.e2e'
Remove-Item Env:E2E_SMTP_PASSWORD
```

The suite does not delete every fixture account/task. Keep its remaining data
inside the disposable environment.

## Authentication fixtures and prerequisite failures

[`ui/_helpers.ts`](ui/_helpers.ts) registers users through the API, obtains a CSRF
cookie/header pair, and reads verification/reset links delivered by Auth to
Mailpit through [`_email.ts`](_email.ts). The helper matches the fixture recipient,
message subject and action-link origin/path. The application logs only the
server-defined email subject and stores token hashes; E2E does not extract secrets
from logs or production mailboxes.

| Setting | Default | Meaning |
|---|---|---|
| `E2E_API_URL` | `http://127.0.0.1:5132` | Gateway for API setup and API project |
| `E2E_FRONTEND_URL` | `http://127.0.0.1:3000` | Browser target and frontend reachability probe |
| `E2E_MAILPIT_URL` | `http://127.0.0.1:8025` | API of the disposable SMTP sink |
| `E2E_SMTP_PASSWORD` | required, no default | Fresh random SMTP credential used by the Compose overlay and Auth sender |

UI files call `requireFrontendReachable()` before running. An unreachable frontend
or a response ≥500 fails the suite; required services cannot silently turn a run
green through skipped tests. The probe alone does not prove that the complete
frontend/backend stack is healthy. Reset/verification flows also require Mailpit
and successful SMTP delivery. Inspect test totals and the process exit code.

## Scope of the suites

The API spec covers registration, email verification, friendship creation,
categories, shared tasks and viewer-specific hide/reveal through the gateway.
Tracked UI specs cover login, registration, password recovery, email verification,
profile rename and task-page entry/create-panel reachability. They do not cover
every branch reply, ownership, realtime reconnect, accessibility or responsive state.

`frozen-audience.api.spec.ts` creates four real verified users and covers frozen All friends snapshots, explicit refresh, child inheritance, direct/gRPC comment access, immediate revocation, cleanup and re-friending, plus retained SignalR sockets and durable notification boundaries. `avatar-native-upload.api.spec.ts` uploads a real PNG through the Linux gateway and verifies all three stored WebP variants with browser decoding and a spoofed MIME rejection. These flows require the real disposable services and never mock API access decisions.

`ui/motion-geometry.ui.spec.ts` is included in the UI project and covers
create-panel focus, task-card controls and navbar geometry in a real browser.
Its rail matrix uses two fresh verified accounts and real friendship, task, worker,
viewer-preference, comment and notification APIs. It measures `/tasks` (including
its completed preview), `/dashboard` and `/tasks/completed` at widths 390, 768,
1280 and 1600 with DPR 1, 1.25, 1.5 and 2, on first/repeated mounts and settled,
card-hover, completion-hover and eye-hover states. Hidden cards are revealed
through the UI before their open rail is measured. Only page-filtered states
are marked N/A: completed cards on Dashboard and active cards in the archive.

The assertions measure the circle border-box, the actual 44px pseudo-element
hit targets, the 22px eye insets, a minimum 14px hit gap, preserved circle spring,
minimal 188px short open cards, unchanged hover/repeat heights and zero layout
shift during each settled control-hover window, after programmatic scrolling and
the fixed-bar morph have finished. They do not assert zero CLS for
initial document loading, navigation or explicit expansion. The matrix's local
480-second test budget and 300-second setup budget allow real Gateway `Retry-After` cooldowns (at most one
UI retry per load). Fixture unread delivery may wait up to 125 seconds through a
genuine Gateway cooldown; production limits remain enabled and no API routes are
mocked. Failures other than a captured 429 are not retried by this helper. The
long matrix renews its own fixture through the real Auth refresh endpoint before
each case, carrying only its latest cookies/CSRF/bearer in memory; access-token
lifetimes remain unchanged.

Each matrix case saves `card-geometry.json` under its Playwright output path with
rects, browser version, measured layout-shift totals, cooldowns and explicit N/A
reasons. The droplet check also saves `droplet-frames.json`, sampled after RAF
writers with actual timestamps. Neither artifact contains fixture tokens, cookie
state or account credentials.
Its discovery does not establish that its assertions passed; inspect the run summary.

The separate [`docs/ui-audit`](../../docs/ui-audit/) scripts use fixture-backed
browser routes. Their visual measurements complement these tests and do not
replace real-service end-to-end checks. See
[`docs/testing.md`](../../docs/testing.md) for coverage scopes and dated results.

## CI

[`.github/workflows/e2e.yml`](../../.github/workflows/e2e.yml) starts Docker, waits
for configured health endpoints, installs Chromium, builds/starts Next.js and runs
both projects on relevant pull requests or manual dispatch. From `frontend/`,
`node e2e/run-ci.cjs` captures child stdout/stderr in memory and redacts action-link
query tokens, JWTs and secret JSON fields before printing diagnostics. CI generates
no HTML report, trace or video and uploads only failure PNG screenshots, not
mail bodies, Mailpit data or raw output. Cleanup stops the frontend and disposable
containers and removes `.env.e2e`. The workflow's browser
cache behavior is defined by its actual steps; npm caching alone does not prove
that downloaded browser binaries are cached.
