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

## Verification — Codex compact-card and notice stage, 2026-10-09

The owner requested a visual notice polish and an eye permanently aligned below
the completion circle after the original verification assignment. This supersedes
the earlier row/corner placement rules. Sparse active cards now measure 160px
(118px rail plus existing padding/border); collapsed cards remain 46px. Completed
cards retain their natural sizing. Unscaled circle/eye hit targets are 44px, with the same
x centre and no intersection. The grid algorithm and animation hooks are unchanged.

| Check | Observed result |
|---|---|
| Full frontend Vitest/V8 suite | 119 files, 1,526 passed |
| V8 statements / branches / functions / lines | 94.06% / 86.13% / 93.97% / 95.87%; all 85% gates passed |
| Frontend ESLint, TypeScript and isolated production build | Passed; final build in `.next-codex-stage2`, not the owner's running `.next` |
| Backend build | 0 errors, 11 warnings; existing obsolete API warnings and native-copy retries |
| Full backend suite with fresh disposable PostgreSQL | 1,209 passed (1,119 Unit + 90 ErrorHandling), 0 failed/skipped; initial run's 59 skips subsequently covered |
| Tracked Markdown lint | 64 files, 0 issues; default root glob separately finds 8 existing issues in untracked local AGENTS files |

Installed tooling differs from the declared manifests: Next 16.2.9, Vitest 4.1.9
and Playwright 1.61.1 were used locally; the manifests request 16.3.8, 4.1.11 and
1.63.0 respectively. These results certify the tested local runtime, not an exact
`npm ci` reproduction. Dependencies and the owner's running server were preserved.

### New coverage and public-browser findings

See `frontend/e2e/README.md` for the compact rail, real-service height-motion
and notice/error scenarios. `global-error.test.tsx` adds three render/recovery
checks. The eye regression was reproduced against the original component (three
short-card cases failed), then passed all ten rail tests. The full suite includes
the updated heavy-card and notice-copy assertions. The copy audit retained 121
`addToast` calls and normalized 79 calls / 84 title expressions; 118 audited
literals had zero violations and a maximum length of 39. Server notification
titles remain producer-owned.

The initial public notice/error UI/axe run passed 5/5 in Chromium 149.0.7827.55.
WebKit 26.5 passed 3/5: native Tab skipped anchors in this Windows configuration,
and popup-then-drag produced a late navigation that did not reproduce in an
independent fresh drag. Error-scene logic was preserved. Firefox 151.0 could not
launch because Windows reported an invalid Side-by-Side configuration; installation
of browser binaries alone did not fix that system-runtime prerequisite.

Axe found an actual serious list-semantics violation in the notice stack. Setting
the positioning list to `role="presentation"` preserved each live announcement;
final notice axe passed in Chromium and WebKit. A later stricter public run
collected `console.error` as well and correctly failed two Chromium cases
while the unavailable Auth/Gateway returned CSRF HTTP 500. Earlier UI/axe passes
do not establish a zero-console result; the real-service rerun is recorded below.

The landing shared-card reserve is 166px. Settled open cards are 160px and hidden
cards 46px in Chromium/WebKit: 6px extra while open, 120px while hidden. This
intentional reserve prevents the surrounding illustration shifting; it was not changed.
A destination check remained on 404 at 200ms and completed navigation after 571ms.

Initial compact runs caught test measurement issues: float32 DOMRect arithmetic
returned 159.99997px and a touching-hit-edge error below 0.001 CSS px; guards now
absorb only that numerical precision. WebKit measurements during entrance
scaling showed targets around 43.966px; tests now wait for scale to settle
rather than lowering the 44px requirement. Chromium DPR-2 desktop runs exhausted
the original 180-second matrix budget, so the extended matrix uses the existing
480-second live-matrix budget.

A separate reduced-motion probe found an existing content-transition transient
in Chromium: 160 → 70 → 46px over the first ~64ms, with no running native height
animation. The strict instantaneous-height assertion remains unchanged. Its Chromium-only
expected-failure annotation is applied after successful setup/final-state checks
and saved frame data; rapid-toggle/focus is tested separately. A Chrome 154 run
failed its final-focus assertion; the later independent diagnostic passed it.
Other engines
retain their normal assertion. Animation logic was not changed. The original Claude build independently reproduced
134 → 70 → 46px in ~63ms, confirming the transient predates the eye fix. Under
normal motion the same probe recorded intermediate
heights 75.0625, 50.625 and 46.6094px before 46px, then no inline height/animation.
That probe was subject to slow RAF delivery and is not a 55-FPS performance proof.

### Final real-service and cross-browser results

Docker Desktop initially failed to start its Linux engine; on 2026-10-09 it
became available. A unique disposable project used gateway 15132, Mailpit 18025
and PostgreSQL 15433, separate containers/network/volumes and fresh secrets held
outside Git. The owner's services and frontend on port 3000 were preserved.

The complete API project passed 3/3 in 3.8 minutes: actual auth/sharing, native
avatar upload/decoding and frozen friend audiences with retained SignalR sockets.
The production browser run uses port 3110 and the same real stack.

A test helper initially ignored HTTP 429 responses proxied through the frontend
origin. A network probe confirmed browser API traffic on port 3110, while direct
fixture setup uses 15132. The helper now records real Retry-After from both
origins; service rate limits and response bodies are unchanged. Public demo
readiness also allows the actual 10-second session request and CSRF retry before
asserting all six cards. Its strict 44px hit targets and geometry limits remain.

The initial complete Chromium UI run used the first versions of the new E2E
scenarios: 44 passed, 20 failed and 12 did not run in serial groups. It is a
diagnostic baseline, not a green certification. All 20 existing motion/geometry
checks passed, including all 16 live width/DPR matrices: 8,654 measurements,
maximum circle-centre error 0.0000611 CSS px, maximum eye x-centre error
0.0000306 CSS px, zero hit intersections and zero CLS in 512 settled control
windows. Short-card height ranged from 159.9961 to 160.0001 CSS px because of
fractional compositor coordinates.

The new harness was corrected after that baseline: it starts completion fixtures
in the real InProgress status, invokes desktop delete via the existing keyboard
handler, confirms actual API state for ActualDate fixtures, waits for restored
authenticated content before offline/chunk navigation, and retains a stable real
card locator when collapsing removes its heading. DELETE/dismiss checks require
exactly one successful gateway deletion followed by a real authenticated GET404.
No product handlers, rate limits, authorization or animation algorithms were
changed to make these checks pass.

The subsequent 45-case Chrome 154.0.8037.98 run (`final-chromium2.log`)
reported 24 passed, 10 failed and 11 not run. One of the 24 is the explicitly
expected Chromium reduced-motion failure: 23 were ordinary passes. After correcting
fixture readiness and selectors, the independent 14-case live geometry/motion
run (`final-live-geometry.log`) completed all cases: 9 passed and 5 failed.
Neither run is an all-green UI result.

The focused 19-case notice/error rerun on the correct isolated production build
(`final-notices4.log`) passed 17, failed one and explicitly skipped one
inconclusive chunk investigation. Completion, the six-mutation deck, Undo without
DELETE, pointer/keyboard eight-second holds, exactly one DELETE at expiry, both
mobile dock surfaces, authenticated/public 404, private missing branches and the
disposable service outage/repetition passed. The Todo service was restarted and
all eleven disposable services were healthy after the outage.

The failed dismiss group observed no DELETE after closing the Undo offer and
waiting 5.4 seconds plus a 10-second assertion window. Dismissal variants are
now four independent tests so close cannot prevent Escape/left/right coverage;
the final new-suite discovery is 48 cases per browser. Gesture and network
counts are saved even when the final DELETE assertion fails.

The seven-case independent Chrome diagnostic (`final-diagnostics.log`) passed
three and failed four. Both desktop compact matrices (1280/1600px, DPR 1) and
rapid hide/show focus passed on this attempt. Captured card/ancestor transforms
showed no remaining scale; the observed hover ancestor only translated by −2px.
This gives a passing observation for every compact width/DPR combination across
the runs, without erasing the earlier scale-settle failures. Each separate
close/Escape/left/right test removed its notice but captured **zero DELETE
requests and zero DELETE responses** before fixture cleanup. All four retain
normal failing assertions; none is marked expected or skipped.

The category-only chunk set was empty: Tasks and Categories already shared all
observed script URLs. The test therefore did not falsely claim a fulfilled HTTP
500 or Retry recovery. Offline navigation reached `/categories`, still displayed
the Categories heading and reported `navigator.onLine === false`; the application
offline error scene was not reached. These are investigation outcomes permitted
by the assignment, not error-scene recovery passes.

After the desktop interruption, an initial server restart accidentally served
the ordinary build because the custom Next server's router ignored its supplied
config. A fresh fixture logged in directly at gateway 15132 with HTTP 200 but
through port 3110 with HTTP 401. The isolated launcher now passes the verified
serialized build configuration to its own child process. The same diagnostic
then returned HTTP 200 directly, through the frontend and in the browser. The
failed startup attempt (`final-notices3.log`) is excluded from product conclusions.

The extended 15-state geometry matrix passed 6/8 combinations and saved 2,476
measurements, including partial evidence from the two failing combinations.
Collected hit intersections and measured settled CLS were zero. The two failures
were completed-card targets at 768px DPR 1 (43.9763px) and after resizing the
1600px DPR 2 case to 768px (43.9829px), below the unchanged 43.999px numerical
guard. These readings may include an unsettled entrance transform; they do not
prove a permanent target-size defect. Six complete cases each saved 348
measurements. Public compact cases passed 6/8; desktop DPR-1 cases failed the
strict scale-settle guard before further measurement. No scale ancestor is
assumed without captured transform evidence.

Recorded column-height spread across mounts, pages, DPRs and round-trip resizes:

| Width | Tasks spread | Dashboard spread | Archive spread |
|---|---|---|---|
| 390px | 0px, one column | 0px, one column | 0px, one column |
| 768px | 52–136px | 77–160px | 52px |
| 1280px | 126–269px | 87–160px | 155.59375px |
| 1600px | 126–269px | 87–160px | 155.59375px |

These are measurements of this fixture set, not a balanced-column guarantee.
The existing grid weights were preserved.

### Motion findings left for the permitted follow-up

Real-service RAF capture passed for owner and shared cards on Tasks and for the
shared card on Dashboard. The tall owner path was 293 → 46 → 293px; the shared
path was 160 → 46 → 160px. Each contained intermediate heights, ended without
inline height/running native animations, and the following card's per-frame
displacement error was 0px. Those three captures contained no pager samples and
cannot certify pagination motion.

- `frontend/src/hooks/use-height-transition.ts` and the existing content transition:
  Chromium reduced motion includes the independently reproduced 70px transient
  described above. Proposal: investigate how the content swap affects natural
  height before the reduced-motion final shape; keep the strict instant-height
  check. The animation code was outside the permitted repair scope.
- `frontend/src/components/todos/todo-card.tsx`: rapidly collapse/re-expand a
  public card, then wait one second. Chrome 154 restored the open shape but the
  final Collapse-button focus assertion failed. Earlier Chromium 149 probing
  and the latest Chrome 154 independent diagnostic passed. The earlier failure
  remains recorded as intermittent; no cause or focus-handler fix is claimed.
- `frontend/src/app/(app)/dashboard/page.tsx:682`: collapse the tall owner
  fixture. The captured real card no longer offered Expand, so the show phase
  could not run. Tasks and the Dashboard shared fixture passed. Investigate the
  owner's hide response/state merge before attributing this to the height hook.
  A later focused capture completed both Dashboard shapes (293 → 46 → 293px)
  but measured a **75px following-card displacement mismatch during hide**,
  above the unchanged 1px guard; show had 0px mismatch. This replaces the earlier
  missing-control observation with an actual failing frame measurement without
  establishing its cause. Tasks repeated the same path with 0px mismatch.
  The separate tallest-column bottom-card test initially timed out in a test
  loop whose indexed Expand locators shifted as buttons disappeared. The loop
  now expands the first remaining button and asserts the real count decreases;
  product pagination/grid logic was not changed.
  The focused three-case rerun (`final-pager.log`) passed Tasks, failed the
  Dashboard 75px assertion and still timed out in the pager case after 180s;
  teardown additionally reported a storage-state protocol error. No successful
  bottom-card pager capture is claimed. This remains an inconclusive case.
- The 60+ real-task capture measured **54.9702 movement FPS**, 56.6805 FPS over
  the whole 800ms window and one overlapping **54ms long task**, from 25 actual
  movement RAF frames. This fails the unchanged ≥55 FPS / no >50ms target.
  A long task overlapping the interval alone does not prove the animation caused
  it; profile the workload before changing any animation/grid code. See
  `animation-performance.json` under `final-live-geometry`.

### Independently reproduced form issue

`frontend/src/app/(app)/categories/page.tsx:68` initializes a new category color
as `var(--pl-accent)`, and `handleCreate` sends it to the real API. Creating a
category with only its name therefore returned HTTP 400 in the notice-deck
scenario: the backend color validator requires a six-digit hex color. This is
outside the allowed logic changes. Proposal: store a valid hex value as the form
default while preserving the visual token. The E2E fixture now explicitly chooses
`0ea5e9` in the existing Hex colour field and verifies the real successful POST;
it does not mock or alter validation.

The dismissed-Undo observation points to
`frontend/src/components/ui/undo-bar.tsx` and `frontend/src/store/toast.ts`:
holding the offer stops the pending-action clock, but removing it can leave no
notice to resume that clock. This is an inference from the code and real missing
DELETE, not a completed root-cause proof. Proposal: define and test whether
dismissal resumes or settles an already paused pending action. Neither pending
action handlers nor the toast-store API were changed.

### Final cross-browser prerequisite result

The final Firefox project discovered all 48 new cases. The first browser launch
failed with `browserType.launch: spawn UNKNOWN` before any page or assertion
ran; the remaining 47 were not run because of the explicit one-failure stop for
this shared prerequisite. This is a browser-runtime failure, not 48 UI failures,
and does not certify Firefox support. The earlier Side-by-Side launch failure
and the final launcher error are both retained in local evidence.

Raw logs, TRX, JSON frame/geometry data and screenshots are kept in ignored
`test-results/codex-stage` and `frontend/test-results/codex-stage`. They are
local evidence, not distributable fixture credentials. No tokens, cookies or
authorization state are included in committed documentation.

## Verification Snapshot — 2026-10-08, preceding stage

These results cover the reviewed integration, frozen friend audiences, migration
startup guard, native avatar decoder and task control rail. Tests used disposable
PostgreSQL/Compose services and a separate production frontend; owner services,
credentials and the running production build were not reused.

| Check | Observed result |
|---|---|
| Backend unit suite with live PostgreSQL cases | 1,119 passed; zero failed/skipped |
| Backend error-handling suite | 90 passed; zero failed/skipped |
| Native avatar boundary tests (included above) | 17 passed on Windows; actual PNG/JPEG/WebP decoding |
| Migration startup checks (included above) | 14 passed: empty database, managed prefixes, compatible existing baseline, rejected gaps/unknown history/unsafe schemas, preservation and concurrent startup |
| Frozen-audience API/SignalR scenario | 1 passed through real Auth/Todo/Collaboration/Realtime services; four users, removal/re-addition, child inheritance and retained sockets |
| Native Linux avatar API scenario | 1 passed; actual upload through the gateway and independent decoding of all three WebP variants |
| Frontend lint / TypeScript / isolated production build | Passed |
| Complete frontend coverage suite | 117 files; 1,502 tests passed |
| V8 statements / branches / functions / lines | 95.36% / 87.94% / 95.72% / 97.14%; all four 85% gates passed |
| Google Chrome 153.0.8010.53 browser suite | 20/20 passed; all 16 width/DPR matrices, 11,131 measurements, 512 settled control windows; maximum centre error 0.000062 CSS px, CLS 0 |
| Production npm / transitive NuGet scans | Zero affected packages in both scans |

The separate full-graph npm scan still reports ten development dependency entries
(seven high, three moderate); its high-severity CI gate remains enabled and fails.
The [dependency review](../.github/security/frontend-dependencies-2026-10.md)
records the unpatched tooling dependency and the compatible-upgrade boundary.
Browser geometry measures its settled control window, not initial-load CLS or
all possible GPU/compositor artifacts.

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
before parents, viewer rows, shares and owned tags with them), the per-viewer hide (including a completion
with no timestamp), the release of workers who completed a task for themselves, the completed archive's
order and date window for such tasks (`TodoArchivePostgresTests`), the notification and
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
accounts through the gateway and SMTP mail delivered to a disposable Mailpit sink.
This is separate from the UI-audit scripts, which route API calls to fixtures and
cannot establish backend integration correctness. The suite uses one worker, a
180-second test timeout and two retries on CI; auth setup respects one
`Retry-After` cooldown without changing the application's rate limits.

API flow exercised by `frontend/e2e/auth-todos-sharing-hidden.api.spec.ts`:

- fetch CSRF token from `GET /auth/api/v1/auth/csrf-token`;
- register two users through `/auth/api/v1/auth/register`;
- read the delivered verification link from Mailpit through `frontend/e2e/_email.ts`, matching the fixture recipient and message subject;
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

`frontend/src/test/quality/usability-contract.test.tsx` also verifies the create panel: collapsed, it shows "New task" with "Date, category, audience" and advertises no key (`C` belongs to quick capture); open, its title is NOT focused — a field lights up only after a click or a keystroke — and the first printable key pressed from nowhere moves focus into the title. `todo-heavy-components.test.tsx` covers the edges of that type-to-focus rule (Ctrl/Cmd chords, Space, another field, an open selector popover) and locks the task card's control rail: the circle in the middle row of a `1fr auto 1fr` grid with a necessary 118px active rail, the eye always aligned below it in the same rail, and a completed card with no empty chip row. `src/test/store/toast.test.ts` covers the notice store (durations, repeats counted, clocks stopping while read, actions, in-place updates, the limit), `dashboard-primitives.test.tsx` the undo offer through the stack (including the window holding while the stack is read), and `segment-error.test.tsx` the crash and offline scenes.

Layout and motion that jsdom cannot measure are covered by `frontend/e2e/ui/motion-geometry.ui.spec.ts` against a production frontend and real services. Its create-panel checks seed nine tasks and verify unfocused opening and type-to-focus. Its separate two-user API fixtures exercise own, friend take-it, in-progress, completed, revealed, tall/Expected, multi-line title and unread-cluster cards on `/tasks` (including its completed preview), `/dashboard` and `/tasks/completed`, at widths 390/768/1280/1600 and DPR 1/1.25/1.5/2. All possible states are measured on first/repeated mounts after entrance and during card, circle and eye hover; only states excluded by the page's actual filters are N/A. Rect assertions require centre error ≤0.5 CSS px, eye insets 23px left / 22px bottom, actual semantic hit areas ≥44px without intersection, preserved circle spring, a minimal 160px short active card, unchanged hover/repeat heights and zero CLS in each settled control window. Programmatic scroll and its intentional fixed-bar morph finish before that window. Every case saves a credential-free `card-geometry.json` with measurements, layout-shift sources and captured real rate-limit cooldowns. The droplet test reads each frame after RAF writers and uses actual sample timestamps; it retains the early peak and adjacent-displacement checks that reject the recorded late 70.6px snap. Unavailable services and failures other than a captured real 429 fail the suite; limiter settings and API responses are not mocked.

`motion-geometry.ui.spec.ts` is tracked and discovered by the UI project in a
clean checkout and CI. Previously recorded browser series remain development
evidence; discovery or a skipped run does not establish current browser correctness.

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

Prepare a fresh disposable stack and production frontend using the
[E2E setup guide](../frontend/e2e/README.md). Do not point these tests at a user's
running stack or reuse their `.env`: they create persistent accounts and tasks.
The base Compose file's fixed ports and container names require a dedicated
machine/runner or coordinated owner-provided overrides; `-p` alone does not isolate it.
The HTTP/SMTP overlay pins Mailpit by image digest, exposes its API only on
loopback, leaves SMTP unpublished and requires a fresh random `E2E_SMTP_PASSWORD`.
Production cookie defaults, CSRF checks and rate limits remain unchanged.

Run locally only after the isolated backend, frontend and SMTP sink are healthy:

```powershell
Push-Location frontend
npm ci
$env:E2E_API_URL = "http://127.0.0.1:5132"
$env:E2E_FRONTEND_URL = "http://127.0.0.1:3000"
$env:E2E_MAILPIT_URL = "http://127.0.0.1:8025"
npm run e2e
Pop-Location
```

Useful Playwright scripts:

```powershell
npm --prefix frontend run e2e
npm --prefix frontend run e2e:debug
npm --prefix frontend run e2e:report
```

Verification/reset tokens come from delivered mail, not application logs or stored
hashes. The full auth/sharing flow requires successful email verification because
friendship requests require verified active users. An unavailable frontend or a
response >=500 fails the reachability hook; required services cannot silently skip
the browser suite. Inspect test totals and the process exit code before claiming success.

CI invokes `node e2e/run-ci.cjs` from `frontend/`. It buffers child stdout/stderr
in memory and redacts query tokens, JWTs and secret JSON fields before printing
diagnostics. CI uploads only failure PNGs; HTML reports, traces, video, mail bodies
and sink data are not published. Local HTML reports are private and may contain
disposable credentials or action links, so do not upload them. The workflow cleans
up the disposable stack and `.env.e2e` after the run.

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
starts Next.js, runs `node e2e/run-ci.cjs`, publishes redacted diagnostics and
only failure PNGs, and cleans up frontend/containers and `.env.e2e`.
The config itself has no `webServer` launcher. The reachability hook fails when
the required frontend cannot be reached; inspect test totals before calling a run complete.
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
