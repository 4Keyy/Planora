# Testing

Planora has backend xUnit tests, frontend Vitest tests, Docker-backed Playwright e2e tests, markdown documentation checks, CI jobs, and coverage configuration.

## Test Inventory

| Area | Path | Framework |
|---|---|---|
| Backend unit/contract tests | `tests/Planora.UnitTests` | xUnit, Moq, FluentAssertions |
| Backend error-handling/integration-style tests | `tests/Planora.ErrorHandlingTests` | xUnit, ASP.NET Core testing |
| Frontend tests | `frontend/src/test` | Vitest, Testing Library, jsdom |
| E2E flow tests | `frontend/e2e` | Playwright APIRequestContext through API Gateway |
| E2E configuration | `frontend/playwright.config.ts` | Playwright |
| Backend coverage settings | `coverage.runsettings` | XPlat Code Coverage |
| Frontend coverage settings | `frontend/vitest.config.ts` | V8 coverage |
| Markdown lint | `.markdownlint-cli2.jsonc` | markdownlint-cli2 |
| Markdown link check | `.lychee.toml`, `.github/workflows/ci.yml` | lychee offline mode |

## Backend Commands

```powershell
dotnet restore Planora.sln
dotnet build Planora.sln
dotnet test Planora.sln --settings coverage.runsettings
```

Run a single backend test project:

```powershell
dotnet test tests/Planora.UnitTests/Planora.UnitTests.csproj
dotnet test tests/Planora.ErrorHandlingTests/Planora.ErrorHandlingTests.csproj
```

## Frontend Commands

Scripts are defined in `frontend/package.json`.

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

Watch mode:

```powershell
npm --prefix frontend run test:watch
```

## Playwright E2E

The e2e suite exercises the gateway and real backend services rather than mocked frontend state.

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

Frontend Vitest coverage in `frontend/src/test/app/todos-page.test.tsx` also verifies that a hidden shared card stays collapsed while reveal hydration is still loading, preventing a redacted `Hidden task` DTO from briefly rendering as an expanded task. The same test file covers author-name enrichment for public friend tasks without direct share rows, and verifies that the todos page re-fetches its task list when the floating navbar dispatches a `planora:task-created` custom DOM event after quick-creating a task.

Component coverage in `frontend/src/test/components/todo-heavy-components.test.tsx` verifies both task completion and reopening triggers from `TodoCard`, including the delayed local animation handoff before the parent status update callback. It also covers the hidden-card category blur, shared+urgent blue frame with red left border, redacted hidden refresh metadata, and create/edit payloads that keep all-friends visibility inside `Share With`. Create panel tests cover normalized submission for title, description, due date, priority, inline category creation, text-limit warning counters, Escape collapse back to the collapsed state, the expanded morphing close action, and all-friends visibility without exposing a tags field. `frontend/src/test/components/ui-wrappers.test.tsx` covers toast store behavior, shared input limit warning styling, and the toast container layer/offset above the fixed navbar. `frontend/src/test/components/todo-small-components.test.tsx` covers the mutually exclusive all-friends/direct-friends selector behavior in `FriendMultiSelect`. `frontend/src/test/components/animated.test.tsx` covers the card-scoped completion celebration variant.

`frontend/src/test/components/navbar.test.tsx` covers the authenticated navbar menu (Dashboard / Todos / Categories tabs), profile/categories navigation, logout flow, and the `planora:task-created` event dispatch after quick-creating a task through the navbar input.

`frontend/src/test/quality/usability-contract.test.tsx` also verifies the collapsed create panel: it shows "New task" as its heading and a `C` keyboard shortcut hint via a `<kbd>` element so the shortcut is self-documenting in the UI.

`frontend/src/test/utils/todo-utils.test.ts` covers `applyCategoryPatch` — the helper that zeros all four category fields (`categoryId`, `categoryName`, `categoryColor`, `categoryIcon`) when a user removes a task's category, compensating for the backend silently ignoring `null` category IDs on PUT.

`frontend/src/test/components/worker-and-comments.test.tsx` covers `WorkerJoinButton` (11 tests) and `TaskComments` (25 tests). `WorkerJoinButton` tests: isOwner null-render, isWorking strip + leave button, isFull lock icon, take-it button + join call, pending/debounce state, arrow hidden during join, `onControlHoverChange` for both hover-tracked branches. `TaskComments` tests: loading skeleton, empty state, comment list render, `isEdited` label, comment count header, `canComment=false` hides input, add comment on button click and Ctrl+Enter, empty-content submit guard, error display on API failure, edit/delete controls shown for own or owner-visible comments, enter edit mode and save, Cancel button and Escape key cancel edit, Ctrl+Enter keyboard save, error display on update/delete failure, Load-earlier pagination, `formatRelative` time branches (just now / Xm ago / Xh ago / locale date), char-count amber warning.

`frontend/src/test/components/color-bends.test.tsx` covers the WebGL animated background system (31 tests):

- `hexToVec3()` — black, white, red, 3-digit shorthand (`#f00`/`#fff`), neutral gray channel equality, gray palette light-to-dark progression, hash-optional input, `Vector3` instance type, determinism.
- `ColorBends` component — div container presence, single-div invariant, `WebGLRenderer` instance created on mount, canvas appended to container, `requestAnimationFrame` started on mount, no RAF when `prefers-reduced-motion` is active, `cancelAnimationFrame` called on unmount, `renderer.dispose()` and `renderer.forceContextLoss()` called on unmount, `ResizeObserver` observed on mount and disconnected on unmount, `pointermove` listener added to window and removed on unmount, `visibilitychange` listener added to document and removed on unmount, full gray config accepted without throwing, extra `className` applied to container div, no throw when unmounted before RAF fires.
- `ColorBendsLayer` — renders without crashing, inner content resolves after lazy load, wrapper has `fixed inset-0 -z-10` classes, wrapper has `pointer-events-none`, unmounts cleanly.

Run locally after the Docker backend stack is healthy:

```powershell
Copy-Item .env.example .env
# edit .env values
docker compose --env-file .env up -d --build

Push-Location frontend
npm install
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

## What The Tests Cover

Confirmed test areas from file paths:

| Area | Examples |
|---|---|
| Building blocks | result model, pagination, specifications, dependency waiter, domain primitives |
| Auth | validators, token service, password validator, password reset, login/register/logout lifecycle, users, sessions, 2FA, friendships, controllers, gRPC |
| Todo | command/query handlers, hidden/viewer state, repositories, mapping, specifications, gRPC clients |
| Category | domain behavior, handlers, validators, repositories, gRPC |
| Messaging | domain, send/get messages, validators |
| Realtime | controllers, hubs, notification handlers, gRPC, infrastructure |
| Error handling | middleware and integration-style error response behavior |
| Frontend | API interceptors, CSRF, auth store, todo types/sorting, category filter, UI components, app pages |

## Coverage Configuration

Backend coverage:

- configured by `coverage.runsettings`;
- outputs Cobertura and JSON;
- excludes test assemblies, generated/bin/obj/migration/designer/program files, and common test libraries.

Frontend coverage:

- configured in `frontend/vitest.config.ts`;
- provider: V8;
- includes `src/**/*.{ts,tsx}`;
- excludes tests, `src/app/**`, Playwright `e2e/**`, Playwright reports, and build artifacts.

## CI Checks

`.github/workflows/ci.yml` runs documentation, backend, and frontend checks.

Documentation:

```powershell
markdownlint-cli2
lychee --offline --no-progress README.md CHANGELOG.md CONTRIBUTING.md SECURITY.md TESTING.md ARCHITECTURE.md 'docs/**/*.md'
```

Backend:

Backend:

```powershell
dotnet restore
dotnet build --no-restore
dotnet test --no-build --collect:"XPlat Code Coverage"
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
- `audit/**`
- `fix/**`

Pull requests target `main`.

`.github/workflows/e2e.yml` runs the Playwright gateway flow on relevant pull requests and manual dispatch. It builds the Docker stack, generates temporary e2e secrets in `.env.e2e`, waits for gateway health endpoints, runs `npm run e2e`, uploads Playwright artifacts, then stops the stack.

## Security Checks

`.github/workflows/security.yml` runs:

- Gitleaks;
- `.NET` vulnerable package check;
- `npm audit --audit-level=moderate`;
- weekly scheduled run on Monday at 02:00.

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
- Update title, description, due date, expected date, priority, and status.
- Verify expected date after due date is rejected.
- Complete todo and verify completed view.
- Delete todo.
- Delete category and verify todo behavior after category deletion.

### Friend Sharing

- Create two users.
- Send friend request by email.
- Accept request.
- Share a todo.
- Confirm shared todo appears to friend.
- Confirm non-owner can only update status.
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
| Auth store/session behavior | `frontend/src/test/store/auth.test.ts` |
| Todo sorting/filter/type behavior | `frontend/src/test/utils` and `frontend/src/test/types` |

## Known Test Gaps To Watch

These are documentation observations, not claims of missing tests after running coverage:

| Area | Why it is risky |
|---|---|
| Browser-rendered e2e | Playwright currently covers the critical API-gateway flow; UI selectors and browser navigation flows still need dedicated coverage. |
| Full multi-service integration breadth | The e2e suite covers auth/todos/sharing/hidden, but messaging/realtime and admin flows are not covered end-to-end. |
| Production smoke tests | The repository has a production baseline, but no deployment environment smoke workflow. |
