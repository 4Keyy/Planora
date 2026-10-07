# Testing

Planora has backend xUnit tests, frontend Vitest tests, Docker-backed Playwright
API and Chromium UI suites, on-demand **k6 load scenarios**, documentation checks,
on-demand mutation-test configurations, and per-PR migration/OpenAPI artifacts.
The sections below distinguish configured gates, observed results and test gaps.

## Test Inventory

| Area | Path | Framework |
|---|---|---|
| Backend unit/contract tests | `tests/Planora.UnitTests` | xUnit, Moq, EF InMemory, NetArchTest.Rules |
| Backend architecture tests | `tests/Planora.UnitTests/Architecture` | xUnit, NetArchTest.Rules |
| Backend error-handling/integration-style tests | `tests/Planora.ErrorHandlingTests` | xUnit, FluentAssertions, ASP.NET Core TestServer, EF InMemory and substituted external dependencies |
| Frontend tests | `frontend/src/test` | Vitest, Testing Library, jsdom |
| E2E API flow | `frontend/e2e/*.api.spec.ts` | Playwright APIRequestContext through API Gateway |
| E2E browser flows | `frontend/e2e/ui/*.ui.spec.ts` | Chromium against a running Next.js frontend and backend stack |
| E2E configuration | `frontend/playwright.config.ts` | Playwright |
| Backend coverage settings | `coverage.runsettings` | XPlat Code Coverage |
| Frontend coverage settings | `frontend/vitest.config.ts` | V8 coverage |
| Markdown lint | `.markdownlint-cli2.jsonc` | markdownlint-cli2 |
| Markdown link check | `.lychee.toml`, `.github/workflows/ci.yml` | lychee offline mode |
| Load / perf scenarios | `perf/k6/scenarios`, `perf/k6/lib`, `perf/README.md` | k6 (JavaScript) |
| Perf CI dispatch | `.github/workflows/perf-smoke.yml` | workflow_dispatch only |
| Migration script artifacts | `.github/workflows/migrations.yml` | `dotnet ef migrations script --idempotent`, six DB-owning services; EF CLI 10.0.8 after restore/Release build |
| OpenAPI artifacts | `.github/workflows/openapi.yml` | `dotnet swagger tofile`, all six HTTP services; Testing skips Todo/Collaboration startup migrations |

## Verification Snapshot — 2026-10-06

These are observed local results collected earlier in this audit, not promises
that every future checkout will produce the same counts. Frontend lint, type check, coverage and production build were rerun after the
parallel UI work at revision `b2e9c70a5781657dc7f24062d2d965c6c846844f`.
Backend results include the publication follow-up that corrected two stale
reset-link expectations and patched the XML cryptography dependency.

| Check | Observed result |
|---|---|
| .NET Release build | Passed with SDK 10.0.300; 0 errors, 9 warnings |
| `Planora.ErrorHandlingTests` | 90 passed |
| `Planora.UnitTests` | 882 passed; zero failed/skipped |
| Backend total | 972 passed; zero failed/skipped |
| Frontend lint / type-check | Passed |
| `npm run test:coverage` | 100 files, 1,231 tests passed |
| V8 statements / branches / functions / lines | 94.48% / 86.46% / 94.20% / 96.34%; all configured 85% thresholds passed |

The initial backend run had two stale password-reset URL expectations:
`RequestPasswordResetCommandHandlerTests.Handle_ShouldPersistHashedTokenAndSendNormalizedResetLink`
and `FrontendLinkBuilderTests.PasswordReset_ShouldUseConfiguredFrontendUrl_AndEscapeOpaqueToken`
expected `/reset-password`, while current `FrontendLinkBuilder` emits
`/auth/reset-password`. The frontend also retains a permanent `/reset-password`
alias. The publication fix changed the expected paths without weakening the
token escaping, hashing or persistence assertions. Forced restore, Release
build with `-warnaserror` and the full backend suite subsequently passed.
Four `motion-geometry.ui.spec.ts` browser tests were discovered but skipped
against localhost because no frontend server was running; browser binaries
were installed. Skips do not establish runtime motion/geometry correctness.

## Backend Commands

```powershell
dotnet restore Planora.sln
dotnet build Planora.sln
dotnet test Planora.sln --collect:"XPlat Code Coverage" --settings coverage.runsettings
```

Run a single backend test project:

```powershell
dotnet test tests/Planora.UnitTests/Planora.UnitTests.csproj
dotnet test tests/Planora.ErrorHandlingTests/Planora.ErrorHandlingTests.csproj
```

### Retention policies on a real PostgreSQL

The suites in `tests/Planora.UnitTests/BuildingBlocks/Retention/Postgres` run every retention policy live —
dry-run off, the real advisory lock — on each service's own `DbContext` model, because the SQL that deletes
data (`ExecuteDelete`, `ExecuteUpdate`, `pg_try_advisory_lock`) is PostgreSQL-only and EF InMemory stops
before it. They cover completed-task deletion with its outbox cascade, the soft-delete purges (children
before parents, viewer rows, shares and owned tags with them), the per-viewer hide, the notification and
delivery windows, deleted-account purge with every dependent row and the avatar sweep, token and recovery
code housekeeping, the opt-in vectors, the outbox/inbox purge, what a deleted account leaves on other
people's tasks, and the lock itself. Each test creates and drops its own database; without the variable
they are skipped.

Account-purge regressions also cover a locked avatar with all dependent rows retained, successful cleanup
on the next pass, continued progress across batches when one account fails, and cancellation before a
physical delete. `Services/AuthApi/Infrastructure/AuthDeletionOutboxTests` uses the same PostgreSQL fixture
to verify atomic account/event persistence, rollback on a database failure, durable cleanup after a Redis
failure, and publication retry after a broker outage. Its DI contract also verifies the Auth processor,
canonical repository and immediate-dispatch signal registrations.

```powershell
docker run -d --name planora-retention-test -e POSTGRES_PASSWORD=retention-test -p 127.0.0.1:55433:5432 postgres:16-alpine
$env:PLANORA_TEST_POSTGRES = "Host=127.0.0.1;Port=55433;Username=postgres;Password=retention-test"
dotnet test tests/Planora.UnitTests/Planora.UnitTests.csproj --filter "FullyQualifiedName~Retention.Postgres"
docker rm -f planora-retention-test
```

CI's backend job runs them on every push against a `postgres:16-alpine` service container.

## Frontend Commands

Scripts are defined in `frontend/package.json`.

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

Watch mode:

```powershell
npm --prefix frontend run test:watch
```

Read the final test summary and process exit code, including failed collection,
skipped tests and coverage-threshold failures. The dated result above is a baseline;
the command should not have a hardcoded expected number of files or tests.

## Playwright E2E

The `api` project exercises the gateway and real backend services. The `ui`
project drives a real Chromium browser against Next.js; helpers create/verify
accounts through the gateway. This is separate from the UI-audit scripts, which
route API calls to fixtures and cannot establish backend integration correctness.

Confirmed flow in `frontend/e2e/auth-todos-sharing-hidden.api.spec.ts`:

- fetch CSRF token from `GET /auth/api/v1/auth/csrf-token`;
- register two users through `/auth/api/v1/auth/register`;
- read the email verification token from Auth API Docker logs emitted by the default `Email__Provider=Log` email service;
- verify both users through public `GET /auth/api/v1/users/verify-email?token=...`;
- send and accept a friend request through `/auth/api/v1/friendships`;
- create owner/viewer categories through `/categories/api/v1/categories`;
- create a shared todo through `/todos/api/v1/todos`;
- verify the viewer can see the shared task;
- hide the shared task through `/todos/api/v1/todos/{id}/viewer-preferences`;
- assert the viewer receives the masked `Hidden task` DTO;
- assert the owner still receives the original title/description;
- reveal the task and verify the viewer receives details again.

Backend unit coverage in `tests/Planora.UnitTests/Services/TodoApi/Handlers/TodoQueryHandlerTests.cs` and `TodoCommandHandlerExpandedTests.cs` verifies that accepted friends can list, open, categorize/hide, and status-update `IsPublic` friend tasks even when there is no direct `sharedWithUserIds` row. It also verifies that redacted hidden shared/public DTOs preserve non-content visual metadata for shared and urgent card frames.

Two regression tests (`UpdateTodo_ShouldPersistVisibility_WhenPrivateTaskMadePublicForAllFriends` and `UpdateTodo_ShouldPersistVisibility_WhenPrivateTaskSharedWithSpecificFriends`) cover the visibility-persistence bug where a private task updated to public or direct-shared would appear correct immediately but revert on page refresh. The root cause was `UpdateTodoCommandHandler` loading the entity via `GetByIdWithIncludesAsync` (AsNoTracking) and then calling `DbSet.Update()` — EF Core marked new `TodoItemShare` rows as Modified (not Added) due to their composite PK being set, emitting UPDATE instead of INSERT. Both tests assert that after handling the command, `todo.IsPublic` or `todo.SharedWith` reflects the expected state and that `Repository.Update` and `UnitOfWork.SaveChangesAsync` are each called exactly once.

Since the comment timeline moved to the Collaboration service, worker lifecycle no longer writes comments inline — it publishes a `TaskActivityIntegrationEvent` through the Todo outbox, which the Collaboration `TaskActivityEventConsumer` turns into the system comment. `tests/Planora.UnitTests/Services/TodoApi/Handlers/WorkerLifecycleEventTests.cs` pins that contract: `JoinTodo_PublishesStartedWorkingActivityEvent` and `LeaveTodo_PublishesLeftActivityEvent` assert the right `TaskActivityType` is enqueued on the outbox (and `LeaveTodo_AsOwner_IsRejected` asserts the owner cannot leave and nothing is published). `UpdateTodo_Viewer_ShouldRemoveWorkerStatusOnCompletion` (in `TodoCommandHandlerExpandedTests.cs`) verifies that a viewer who is a worker and marks the task as Done has their worker row removed from `todo.Workers`.

### Collaboration service tests

`tests/Planora.UnitTests/Services/CollaborationApi/` mirrors the comment behaviour that previously lived under TodoApi:

- `Domain/CommentTests.cs` — the `Comment` aggregate: create/system/genesis factories, content limits (2000 / 5000), trimming, author-only edit, soft delete, domain-event emission.
- `Handlers/CommentCommandHandlerTests.cs` — the access matrix delegated to `ITaskAccessService`: grant/deny/not-found for add, owner-only genesis with duplicate guard, author-vs-owner delete rules (and that non-genesis system comments are undeletable), and that adding a comment fans out one `NotificationEvent` per other participant.
- `IntegrationEvents/IntegrationEventConsumerTests.cs` directly tests lifecycle handlers: `TaskCreated_WritesOnlyTheCreatedSystemComment` asserts one created system comment and no stored genesis; activity tests check sentences and unknown-type skipping; task/subtask/user deletion tests check the intended repository calls. These are direct mocked-handler tests, not proof of atomic inbox recording, duplicate-delivery safety or a live database cascade.

Frontend Vitest coverage in `frontend/src/test/app/todos-page.test.tsx` also verifies that a hidden shared card stays collapsed while reveal hydration is still loading, preventing a redacted `Hidden task` DTO from briefly rendering as an expanded task. The same test file covers author-name enrichment for public friend tasks without direct share rows.

Component coverage in `frontend/src/test/components/todo-heavy-components.test.tsx` verifies both task completion and reopening triggers from `TodoCard`, including the delayed local animation handoff before the parent status update callback. It also covers the hidden-card category blur, shared+urgent blue frame with red left border, redacted hidden refresh metadata, and create/edit payloads that keep all-friends visibility inside `Share With`. Create panel tests cover normalized submission for title, description, due date, priority, inline category creation, text-limit warning counters, Escape collapse back to the collapsed state, the expanded morphing close action, and all-friends visibility without exposing a tags field. `frontend/src/test/components/ui-wrappers.test.tsx` covers toast store behavior, shared input limit warning styling, and the toast container layer/offset above the fixed navbar. `frontend/src/test/components/todo-small-components.test.tsx` covers the mutually exclusive all-friends/direct-friends selector behavior in `FriendMultiSelect`. `frontend/src/test/components/animated.test.tsx` covers the card-scoped completion celebration variant.

`frontend/src/test/components/navbar.test.tsx` covers the app bar: the three destinations visible without hover and the current one marked with `aria-current`, the account disclosure (attributes, profile navigation, sign-out with and without a reachable API, outside-click and Escape with focus returned to the trigger), the search button opening the command palette with its own rect as the palette's origin, the phone sheet (its links, Escape returning focus to the toggle) and the one-popover-at-a-time rule between the sheet and the notifications.

The command palette is covered in five files. `command-palette-search.test.ts` and
`command-palette-sections.test.ts` test the pure rules: accent folding, fuzzy matching and
the positions it marks, the `#` `@` `>` operators, keyword matching that never accepts
scattered letters (in a task's description or a command's hint), the deadline wording and
the six smart views, `byUrgency`, the task mapping (the API's "In Progress", worker ids,
"You"), what the list holds with nothing typed, per tab, while searching (best group first,
per-kind limits, totals, the create row) and inside a scope, and the per-tab counts.
`command-palette-recent.test.ts` covers the per-account history (order, limit, foreign or
broken storage, a refused write). `command-palette.test.tsx` drives the mounted palette
against a URL-routed API mock with a fresh account per test: Ctrl+K (also on a Cyrillic
layout), the app bar's request and its origin, the backdrop, layered Escape, scroll lock,
keys kept from the page behind, closing on sign-out, the empty state's sections and view
chips, the combobox pattern (wrapping arrows, PageUp/PageDown, pointer), Recent, the
preview, marked letters, tab counts and the live region, Enter, Ctrl+Enter and middle click,
create-from-query in place and through `/tasks`, the shortcut map, Show all, deduplication,
a failed read with Try again, and narrowing by category, person and view.
`command-palette-chrome.test.tsx` covers the rolling hint (with fake timers, including a
lost `transitionend`), the contextual footer, the chips, the scope bar, the rows and every
preview. `quick-capture.test.tsx` covers a capture asked for by the palette — prefilled,
waiting for a later mount, answered once, expiring — and `shortcuts-overlay.test.tsx` the
**Search** group and `OPEN_SHORTCUTS_EVENT`.

`frontend/src/test/quality/usability-contract.test.tsx` also verifies the create panel: collapsed, it shows "New task" with "Date, category, audience" and advertises no key (`C` belongs to quick capture); open, its title is NOT focused — a field lights up only after a click or a keystroke — and the first printable key pressed from nowhere moves focus into the title. `todo-heavy-components.test.tsx` covers the edges of that type-to-focus rule (Ctrl/Cmd chords, Space, another field, an open selector popover) and locks the task card's control rail: the circle in the middle row of a `1fr auto 1fr` grid, the eye pinned to the bottom-left corner, and a completed card with no empty chip row.

Layout and motion that jsdom cannot measure are covered in a real browser by `frontend/e2e/ui/motion-geometry.ui.spec.ts`: it seeds nine tasks through the create panel, then asserts that "New task" opens with an unfocused title and that typing (starting with the page's `F` shortcut letter) lands in it; that every open card's circle is within 0.5px of the card's vertical centre and its eye as far from the bottom as from the left, at 390px and 1280px; and that the droplet bar condenses in one motion — sampled every animation frame, the width's fastest frame must come within the first eight (one spring is a single early bell), and no frame may move more than 1.6× the frame before it plus 2px (at most 6px after a near-still frame). Checked against the recorded series: the old bug — a 70.6px frame after an 11.7px one, nine frames in — fails both rules; the fixed bar passes. The suite seeds through the create panel, which `/tasks` closes after every create, and signs in once for the whole file because the Auth API allows three registrations and five sign-ins a minute per address. Run it against a production build (`next start`), not `next dev`.

At the audit snapshot, `motion-geometry.ui.spec.ts` is a local untracked suite.
Its assertions and previously recorded browser series above are preserved as
development evidence; a clean checkout and CI do not include that file unless
it is separately added. This documentation audit did not execute the suite.

`frontend/src/test/utils/todo-utils.test.ts` covers `applyCategoryPatch` — the helper that zeros all four category fields (`categoryId`, `categoryName`, `categoryColor`, `categoryIcon`) locally when a user removes a task's category. The backend ignores `null` category IDs on PUT, so this test establishes the local projection, not durable removal after reload.

`frontend/src/test/components/worker-and-comments.test.tsx` covers `WorkerJoinButton`,
`TaskComments` and its genesis-card behavior: owner/worker/full-state controls,
single-flight joins, loading/empty/error rendering, add/edit/delete, Ctrl+Enter,
Escape/cancel, pagination, relative timestamps and limit warnings. Test counts in
individual files are not a contract; inspect the current file and run summary.

`frontend/src/test/components/color-bends.test.tsx` covers the raw WebGL background
with a stubbed WebGL context. It does not exercise a real GPU or three.js:

- `hexToVec3()` — numeric three-element RGB tuples, shorthand/hash-optional input,
  gray-channel equality, progression and determinism.
- `ColorBends` — canvas/context setup, uniform updates, RAF, reduced-motion and
  visibility handling, resize/input listeners and WebGL resource cleanup.
- `ColorBendsLayer` — lazy/static behavior, landing-route scope, low-resource
  device heuristics and cleanup.

Run locally after the Docker backend stack is healthy:

```powershell
if (-not (Test-Path -LiteralPath .env)) {
    Copy-Item -LiteralPath .env.example -Destination .env
}
# Configure the local file; preserve existing values.
docker compose --env-file .env up -d --build

Push-Location frontend
npm ci
$env:E2E_API_URL = "http://127.0.0.1:5132"
$env:E2E_AUTH_LOG_CONTAINER = "planora-auth-api"
npm run e2e
Pop-Location
```

Useful Playwright scripts:

```powershell
npm --prefix frontend run e2e
npm --prefix frontend run e2e:debug
npm --prefix frontend run e2e:report
```

`E2E_VERIFY_EMAIL_FROM_LOGS=false` exists as a skip switch for environments that cannot expose Docker logs, but the full auth/sharing flow requires email verification because friendship requests require verified active users.

## Frontend Test Traps

The frontend suite runs in jsdom, which has no layout, no compositor and no platform. Every item below is a place where a test can pass while the component it covers is broken, so each one is written as the trap, the fix, and the file that exercises it.

### Testing motion and reduced motion

framer-motion reads `prefers-reduced-motion` once per module instance. `initPrefersReducedMotion()` in `frontend/node_modules/framer-motion/dist/es/utils/reduced-motion/index.mjs` sets a module-level `hasReducedMotionListener.current = true`, then caches the media query result into `prefersReducedMotion.current`. `useReducedMotion` (`.../use-reduced-motion.mjs`) calls that initialiser only while the flag is still false, and reads the cached value into `useState`.

So the first test in a file that renders anything calling `useReducedMotion` locks the value for every test after it. Re-stubbing `window.matchMedia` in a later test changes nothing: the listener is already installed and the value already cached. The test passes alone and fails in the suite, which is the worst failure mode a test can have.

Mock the hook rather than the media query. The pattern at the top of `frontend/src/test/components/presence-row.test.tsx`:

```ts
const reduceMotion = { current: false }

vi.mock("framer-motion", async (importOriginal) => {
  const actual = await importOriginal<typeof import("framer-motion")>()
  return { ...actual, useReducedMotion: () => reduceMotion.current }
})
```

One switch drives every test in the file, and it drives the thing the component actually depends on. The `matchMedia` stub stays for the code that reads the query directly; it is no longer what decides the animation.

Exit animations are the other half of the same problem. framer-motion does not drive an `exit` variant to completion in jsdom, so assert the effect — the callback that fired, the row that left the data — and never the exit itself. `frontend/src/test/components/dashboard-primitives.test.tsx` asserts that the undo window's commit never happens rather than that the undo bar disappeared. Where the removal genuinely is the behaviour under test, poll for it with `waitFor` instead of asserting it synchronously, as `frontend/src/test/components/date-filter-popover.test.tsx` does for the popover's Escape close.

Entry transitions can also lag behind a React state update: `BranchStory` keeps
future rows in the DOM with hidden visibility, then reveals them on a motion
frame. Its cycle test in `frontend/src/test/app/landing-blocks.test.tsx` uses
`findByRole` before pressing the newly revealed circle and after reopening,
and `waitFor` for the completion row's visibility. These bounded waits retain
the accessible-name and visibility assertions without assuming that a click
also finished the next animation frame. jsdom assertions still do not measure
browser geometry or frame-by-frame motion.

### Other jsdom traps

| Trap | Why the test lies | Fix | Exercised by |
|---|---|---|---|
| Portalled content is not under the render `container` | `Overlay` mounts through `ModalPortal` into `<body>`, so a container query finds an empty div and reports zero — which reads as "the overlay renders no pairs" rather than "the query looked in the wrong subtree" | query `document.body` | `frontend/src/test/components/shortcuts-overlay.test.tsx` |
| `NumberRoll` renders its digit twice by design | The animated column carries one copy and `<span class="sr-only">` the other, so `getByText` throws "found multiple elements" on a component that is behaving correctly | `getAllByText` | `frontend/src/test/components/redaction-badge.test.tsx` |
| jsdom has no `AnimationEvent`, so React listens for `webkitAnimationEnd` | `fireEvent.animationEnd` dispatches `animationend`, which React does not hear in jsdom: a CSS-presence surface (`useExitPresence`) never unmounts and the test fails against working code | fire both names (`endAnimation` helper) | `frontend/src/test/hooks/use-exit-presence.test.tsx` |
| `HTMLElement.prototype.scrollIntoView` shadows an `Element.prototype` stub | `frontend/src/test/setup.ts` already defines the method on `HTMLElement.prototype`. A spy installed on `Element.prototype` is never reached, because the call on an `HTMLElement` resolves the nearer prototype first — so it records zero calls and the assertion fails against working code | spy on `HTMLElement.prototype` | `frontend/src/test/hooks/use-list-navigation.test.tsx` |
| `userEvent.keyboard("J")` does not set `shiftKey` | It types the character `J` with `shiftKey: false`. A Shift binding tested this way covers nothing and stays green | write `{Shift>}J{/Shift}` | `frontend/src/test/hooks/use-list-navigation.test.tsx` |
| jsdom has no layout, so it never updates `scrollY` and never fires `scroll` | A scroll-dependent policy is simply never entered, and every branch of it reads as the top-of-list case | assign `window.scrollY` / `element.scrollTop` and dispatch a `scroll` event by hand | `frontend/src/test/components/update-pill.test.tsx` |

The `use-list-navigation` Shift case is not hypothetical. Shift rewrites the character it produces, so `Shift+j` arrives as `"J"`, not as `"j"` with `shiftKey` set; reading `event.shiftKey` on the `"j"` branch matched nothing and the vim-style extend-selection was dead code that typechecked. `frontend/src/hooks/use-list-navigation.ts` folds `"J"` back to `"j"` before dispatch so `Shift+J` and `Shift+↓` are genuinely one binding.

### What a good test asserts here

Assert what a user or assistive technology can observe: a role, an accessible name, the text that appeared, the callback that was called with which arguments. Do not assert a class name or an internal state field — those change when someone restyles or refactors, which is churn, and they stay unchanged when the behaviour breaks, which is the expensive direction.

The exception is a class that *is* the behaviour. `UpdatePill` keeps an `h-0` container when the count is zero specifically so the presence boundary outlives the thing that animates; `expect(container.firstElementChild).toHaveClass("h-0")` is an assertion about layout contract, not about styling taste.

What this costs when it goes wrong is on record. `useFocusTrap` returns a callback ref backed by state rather than a `useRef`, because every modal in the product mounts through `ModalPortal`, which renders `null` on its first pass and creates the portal from its own effect. With a `useRef` the trap's effect ran one tick early, found `ref.current === null`, returned, and — because `active` never changed afterwards — never ran again. Every dialog in the product shipped a focus trap that did nothing: focus stayed on the page behind, Tab walked straight out, and focus was never returned to the trigger on close.

The hook's own tests passed the whole time, because they mounted it without a portal — the one configuration no caller uses. `frontend/src/test/hooks/use-focus-trap.test.tsx` now ends with a test that mounts the trap inside a real `ModalPortal` and waits for focus to land, so the covered configuration is the shipped one.

## Performance / Load (k6)

The k6 baseline lives in [`perf/k6/`](../perf/k6/). Two scenarios ship today; both share `lib/api.js` (CSRF bootstrap, register, login) so new scenarios extend the lib instead of duplicating boilerplate.

| Scenario | Endpoint(s) | Stage profile | Key thresholds |
|---|---|---|---|
| `scenarios/login.js` | `POST /auth/api/v1/auth/login` after CSRF fetch and one-time register | warmup 10s @ 1 VU → ramp 20s @ 5 VUs → steady 30s @ 10 VUs | `login p95<800ms`, `p99<1500ms` (steady), `csrf p95<200ms`, `http_req_failed<1%` |
| `scenarios/todo-list.js` | `GET /todos/api/v1/todos?pageNumber=1&pageSize=20` (real auth context) | warmup 10s @ 1 VU → steady 30s @ 10 VUs | `todo_list p95<400ms`, `p99<800ms`, `http_req_failed<1%` |

Run locally against the Docker stack:

```powershell
docker compose --env-file .env up -d --build
k6 run perf/k6/scenarios/todo-list.js -e API_BASE_URL=http://127.0.0.1:5132

# With JSON output for later diffing against a baseline:
k6 run --out json=perf/results/todo-list.json `
  perf/k6/scenarios/todo-list.js `
  -e API_BASE_URL=http://127.0.0.1:5132
```

[`.github/workflows/perf-smoke.yml`](../.github/workflows/perf-smoke.yml) reproduces the same flow in CI on `workflow_dispatch` — load tests are deliberately not on every PR. Absolute latency numbers are hardware-bound; the value is in catching `+20%`-class regressions on the same runner class. Baselines, when established for a release-candidate hardware shape, live under `perf/baselines/`.

## Migration Script Artifacts (per PR)

When schema-relevant paths or the workflow change,
[`.github/workflows/migrations.yml`](../.github/workflows/migrations.yml) builds
the startup projects in Release after solution restore and runs EF CLI 10.0.8
with `migrations script --idempotent` for Auth, Category, Todo, Messaging,
Collaboration and Realtime. It uploads `.sql` files with
30-day retention and checks non-empty scripts for idempotence markers.
These scripts are review artifacts generated from the current migration sets.
Realtime's API startup project includes a private EF design-time reference so
the tool can load its context factory, matching the other API projects.
`Planora.Migrator --all` applies those sets through EF rather than reading the
uploaded SQL files. Artifact generation is not proof of a successful production migration.

## OpenAPI Artifacts (per PR)

When a PR changes anything in `BuildingBlocks/**`, `Services/**`, `GrpcContracts/**`, `.config/dotnet-tools.json`, `Directory.Packages.props`, or the workflow itself, [`.github/workflows/openapi.yml`](../.github/workflows/openapi.yml) extracts a fresh `swagger.json` for all six HTTP services (auth, category, todo, messaging, realtime, collaboration) via the `Swashbuckle.AspNetCore.Cli` local tool (`dotnet swagger tofile`). Each artifact is uploaded with 30-day retention.

The workflow uses the existing `Testing` environment guard to skip Todo and
Collaboration startup migrations during metadata collection. It provides
Postgres, Redis and RabbitMQ for other startup dependencies; extracting a
document does not prove database startup or schema correctness. The JSON is
validated post-extraction with `jq -e '.openapi and .info.title and .paths'` so
a malformed document fails the job rather than passing as a zero-byte artifact.

After extraction every artifact is linted by **Spectral** (`@stoplight/spectral-cli`) against the ruleset declared in [`.spectral.yaml`](../.spectral.yaml). The CI step runs with `--fail-severity=error` so contract-stability rules (`oas3-schema`, `operation-success-response`, `path-keys-no-trailing-slash`, `oas3-valid-media-example`, `oas3-valid-schema-example`, `operation-operationId-unique`, `operation-operationId-valid-in-url`) gate the merge. Documentation-friendliness rules (`info-description`, `operation-description`, `tag-description`, `oas3-parameter-description`) are downgraded to `hint`: they surface in the job log so reviewers see the gaps, but do not block the merge while controller XML doc coverage is incomplete.

Schema ids are sanitised at extraction time by `PlanoraSwaggerExtensions.SanitizeSchemaId` — closed-generic CLR FullNames like `PagedResult\`1[[FriendDto, Planora.Auth.Application, Version=1.0.0.0, …]]` are collapsed via a regex replacement of every non-alphanumeric-or-dot character into a single `_` so the resulting `$ref` is a valid URI-reference fragment and Spectral's `oas3-schema` accepts it. Determinism and round-trip are pinned by `tests/Planora.UnitTests/Services/Infrastructure/PlanoraSwaggerSchemaIdTests.cs`.

The artifacts are the contract that any future generated TypeScript client will be derived from. Reviewers can already diff the documents across PRs to spot breaking-change additions, removed properties, or renamed schemas before they reach the frontend; Spectral pre-validates the diff so a malformed contract never reaches the diff window.

## What The Tests Cover

Confirmed test areas from file paths:

| Area | Examples |
|---|---|
| Building blocks | result model, pagination, specifications, dependency waiter, domain primitives |
| Auth | validators, token service, password validator, password reset, login/register/logout lifecycle, users, sessions, 2FA, friendships, controllers, gRPC |
| Todo | command/query handlers, hidden/viewer state, repositories, mapping, specifications, gRPC clients |
| Category | domain behavior, handlers, validators, repositories, gRPC |
| Messaging | domain, send/get messages, validators |
| Realtime | controllers, notification/sync handlers, task-branch authorization, gRPC, connection/read-store infrastructure |
| Collaboration | comment aggregate, validators, comment handlers and integration-event consumers |
| Error handling | middleware and integration-style error response behavior |
| Frontend | API interceptors, CSRF, auth store, todo types/sorting, category filter, UI components, app pages |

## Coverage Configuration

Backend coverage:

- configured by `coverage.runsettings`;
- outputs Cobertura and JSON;
- excludes test assemblies, generated/bin/obj/migration/designer/program files, and common test libraries.
- no numeric backend coverage threshold is configured in the CI job or runsettings;
  collecting a report alone does not enforce the frontend's 85% policy on .NET.

Frontend coverage:

- configured in `frontend/vitest.config.ts`;
- provider: V8;
- includes `src/**/*.{ts,tsx}`;
- excludes tests, `src/app/**`, and the entire `src/components/todos/edit-todo-modal/**`
  subtree. Unit/browser tests may exercise these areas, but the coverage percentages
  do not measure them, and the browser suite does not cover every branch-editor state;
- thresholds: ≥85% for statements, branches, functions, and lines.

`TodoApiTestFactory` runs Todo API in ASP.NET Core TestServer, replaces persistence
with EF InMemory and substitutes gRPC/RabbitMQ/Redis dependencies. These tests
exercise middleware and HTTP behavior but do not establish PostgreSQL transaction,
query-translation, production Redis stamp-check or real-gateway correctness. Its
`CreateGatewayClient()` is a simulated client, not a running Ocelot gateway.

## CI Checks

`.github/workflows/ci.yml` runs documentation, backend, and frontend checks.

Documentation:

```powershell
markdownlint-cli2
lychee --offline --no-progress README.md CHANGELOG.md CONTRIBUTING.md SECURITY.md TESTING.md ARCHITECTURE.md 'docs/**/*.md'
```

Backend (with a `postgres:16-alpine` service container and `PLANORA_TEST_POSTGRES` set, so the retention
policies run live — see "Retention policies on a real PostgreSQL"):

```powershell
dotnet restore Planora.sln
dotnet build Planora.sln --no-restore --configuration Release -warnaserror
dotnet test Planora.sln --no-build --configuration Release `
  --collect:"XPlat Code Coverage" --settings coverage.runsettings `
  --results-directory ./coverage/backend
```

Frontend:

```powershell
npm ci
npm run lint
npm run type-check
npm run test:coverage
npm run build
```

Branches configured in the workflow:

- `main`
- `develop`
- `audit/**`
- `fix/**`

Pull requests target `main` or `develop`.

`.github/workflows/e2e.yml` runs both Playwright projects on relevant pull
requests and manual dispatch. It starts the Docker stack using temporary
environment secrets, waits for gateway health, installs Chromium, builds and
starts Next.js, runs `npm run e2e`, uploads reports and stops frontend/containers.
The config itself has no `webServer` launcher. A local UI file skips when the
helper cannot reach the frontend; inspect skipped totals before calling a run complete.
See [`frontend/e2e/README.md`](../frontend/e2e/README.md) for full local setup.

## Mutation Testing

Mutation testing (Stryker.NET) measures how effectively the tests detect
deliberately introduced faults. It is set up as a local tool and a config
file, and is run on demand (it is too slow for every CI push):

```powershell
dotnet tool restore
dotnet stryker
```

Two scoped configs ship with the repo. Run each individually:

```powershell
# Hidden-shared-todo factory and viewer-state resolver.
dotnet stryker

# Auth security modules (PasswordValidator, TwoFactorService,
# RecoveryCodeService).
dotnet stryker -f stryker-auth.json
```

Only `stryker-auth.json` currently declares ignored `string` and `statement`
mutations; the default config does not. Both use high/low/break thresholds of
90/80/70. Reports are written to the git-ignored `StrykerOutput/` directory.
There is no automatic mutation-test CI job or current score established by the
documentation audit; record a dated report before claiming an achieved score.

## Security Checks

`.github/workflows/security.yml` runs:

- Gitleaks secret scan;
- CodeQL SAST (`csharp` and `javascript-typescript`, `security-extended` queries);
- Trivy IaC/Dockerfile misconfiguration scan;
- `.NET` vulnerable package check;
- `npm audit --audit-level=moderate`;
- weekly scheduled run on Monday at 02:00.

CodeQL and Trivy publish SARIF results to the repository Security tab.

Dependabot is configured for:

- npm in `/frontend`;
- NuGet in `/`.

## Manual QA Checklist

Use this after feature changes or before a release.

### Auth

- Fetch CSRF token.
- Register a user.
- Log out.
- Log in with `rememberMe=false`.
- Reload browser and confirm session behavior.
- Log in with `rememberMe=true`.
- Trigger refresh by expiring/clearing access token state.
- Change password.
- Request password reset.
- Enable/confirm/disable 2FA.
- Revoke one session and revoke all sessions.
- Open `/profile` on desktop and mobile widths and verify the profile center tabs, identity form, security panels, sessions, login history, friends, and admin-only section remain reachable.

### Todos And Categories

- Create category.
- Create todo with category.
- Create todo without category.
- Update title, description, estimated-completion date/interval, priority and status.
- Verify interval start after end is rejected, and clearing the interval stays
  cleared after reload. `expectedDate` is a legacy DTO field, not the editor's
  current date-picker input.
- Complete todo and verify completed view.
- Delete todo.
- Delete category and verify todo behavior after category deletion.

### Friend Sharing

- Create two users.
- Send friend request by email.
- Accept request.
- Share a todo.
- Confirm shared todo appears to friend.
- Confirm viewers cannot rename/rewrite the parent task, and can only use their
  allowed worker, personal category/hide/completion and branch/subtask actions.
- Confirm an owner's global completion prevents a viewer reopening the task;
  duplicate makes a fresh task instead.
- Hide shared todo as viewer and verify redaction.
- Reveal shared todo and verify details reload only after explicit action.

### Messaging / Realtime

- Send message to another user.
- Load messages with pagination.
- Open realtime connection and verify active connection count.
- Send notification to current user.
- Verify admin-only endpoints reject non-admin users.

## Writing New Tests

| Change type | Add/modify tests |
|---|---|
| Command/query handler | backend unit test under matching service folder |
| Controller route/contract | controller test and API docs update |
| Middleware/error mapping | `tests/Planora.ErrorHandlingTests` |
| EF repository/query behavior | repository or infrastructure tests |
| Frontend API client behavior | `frontend/src/test/lib` |
| Frontend component behavior | `frontend/src/test/components` or `frontend/src/test/app` |
| Frontend hook behavior | `frontend/src/test/hooks` — mount the hook in the configuration its callers use, not the simplest one that compiles |
| Auth store/session behavior | `frontend/src/test/store/auth.test.ts` |
| Todo sorting/filter/type behavior | `frontend/src/test/utils` and `frontend/src/test/types` |

## Known Test Gaps To Watch

These are documentation observations, not claims of missing tests after running coverage:

| Area | Why it is risky |
|---|---|
| Browser-rendered breadth | Existing UI specs cover sign-in/register/recovery/verification, profile rename and basic task-page entry. They do not cover every branch reply, autosave, ownership, viewport or failure state. |
| Full multi-service integration breadth | The e2e suite covers auth/todos/sharing/hidden, but messaging/realtime and admin flows are not covered end-to-end. |
| Production smoke tests | The repository has a production baseline, but no deployment environment smoke workflow. |
| Relational persistence | Many backend repository/factory tests use EF InMemory; passing them does not verify PostgreSQL-specific SQL, constraints or transaction behavior. The retention policies are the exception: they run live on PostgreSQL (see above). |
| Excluded frontend source | Route pages and the full branch-editor subtree are excluded from numeric coverage; audit their behavior independently. |
| Session transitions | Friend cache isolation across accounts, scheduled refresh after later login and long-lived realtime reconnect exhaustion need targeted regression coverage. |
