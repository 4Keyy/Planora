# Codebase Map

This map is organized by ownership boundary. It intentionally avoids generated artifacts such as `bin/`, `obj/`, `.next/`, `node_modules/`, logs, caches, and test results.

## Root

| Path | Purpose | Key files |
|---|---|---|
| `README.md` | project entry point | links to docs and quick start |
| `AGENTS.md` | agent/AI-assistant rules for this repository | routing, per-project tie-breakers |
| `.env.example` | local environment template | required Docker secrets and local defaults |
| `.env.production.example` | production key template | secret/config checklist for deployment platforms |
| `docker-compose.yml` | local infrastructure and backend containers | service ports, env injection, health checks |
| `Planora.sln` | backend solution | gateway, six services, building blocks, gRPC contracts, tests |
| `Directory.Build.props` | shared .NET project defaults | `net10.0`, nullable, warnings as errors |
| `Directory.Packages.props` | central NuGet versions | ASP.NET Core, EF Core, MediatR, Ocelot, Serilog, test packages |
| `global.json` | pinned .NET SDK | keeps CI and the local SDK on one band |
| `coverage.runsettings` | .NET coverage configuration | excludes generated/migration/program files |
| `stryker-config.json`, `stryker-auth.json` | mutation-testing configuration | one general run, one scoped to Auth |
| `Start-Planora-Docker.ps1` | Docker backend launcher | preflight, Compose, frontend |
| `Start-Planora-Local.ps1` | full local launcher (host processes) | infra in Docker, `dotnet run` services + gateway, `npm run dev` frontend, health gating, `-Lan` sharing |
| `.editorconfig` | unified charset / EOL / indentation / C# analyzer severity hints | applies to every file in the repo |
| `.gitleaks.toml`, `.gitleaksignore` | gitleaks ruleset extension and allowlist | Planora-specific secret detectors + env-var-interpolation allowlist |
| `.spectral.yaml` | OpenAPI lint ruleset | consumed by `openapi.yml` |
| `.markdownlint-cli2.jsonc`, `.lychee.toml` | docs lint and link-check configuration | keeps cross-links in this tree resolvable |
| `.githooks/pre-commit` | repo-local git hook | installed by `scripts/install-hooks.sh` |
| `.github/workflows` | CI/security/e2e/SBOM/migrations/perf/CD/OpenAPI automation | `ci.yml`, `e2e.yml`, `security.yml`, `migrations.yml`, `perf-smoke.yml`, `cd.yml`, `openapi.yml`, `nuget-vuln-pr.yml` |
| `scripts` | local PowerShell helpers (launcher + Phase-1 verification) | `HealthChecker.psm1`, `PidManager.psm1`, `PortChecker.psm1`, `Verify-Phase1-Prereqs.ps1`, `install-hooks.sh` |
| `graphify-out` | generated knowledge graph (gitignored) | `GRAPH_REPORT.md`, `wiki/index.md`, `graph.json` |
| `tools/Planora.Migrator` | one-shot EF Core migration runner CLI | `Program.cs`, `CollaborationBackfill.cs`, `CollaborationRepliesUpgrade.cs`, `Dockerfile` |
| `deploy/fly` | Fly.io app manifests + bootstrap scripts | nine `*.fly.toml`, `setup.ps1`, `set-secrets.ps1`, `.env.fly.example`, `README.md` |
| `perf` | k6 load-test scenarios and baseline | `k6/lib/api.js`, `k6/scenarios/{login,todo-list}.js`, `README.md` |
| `docs/INVARIANTS.md` | closed-form architectural invariants | `INV-OWN-*`, `INV-COMM-*`, `INV-AUTH-*`, `INV-AZ-*`, `INV-OBS-*`, `INV-FLOW-*` |

> `deploy/fly/outbox-worker.fly.toml` is checked in but **reserved**: it points at
> `tools/Planora.Outbox.Worker/Dockerfile`, which does not exist yet. The manifest fixes the app
> name and secret-set pattern ahead of the extraction; it must not be deployed until the project
> is in the solution.

## Shared Backend Building Blocks

| Path | Purpose |
|---|---|
| `BuildingBlocks/Planora.BuildingBlocks.Domain` | base domain types, `Result`, `Error`, domain exceptions |
| `BuildingBlocks/Planora.BuildingBlocks.Application` | CQRS abstractions, pagination, validators, business logging contracts |
| `BuildingBlocks/Planora.BuildingBlocks.Infrastructure` | middleware, logging, repositories, EF helpers, Redis/RabbitMQ, outbox/inbox, JWT, health checks |

Important files:

- `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Middleware/CsrfProtectionMiddleware.cs`
- `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Middleware/EnhancedGlobalExceptionMiddleware.cs`
- `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Extensions/JwtAuthenticationExtensions.cs`
- `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Extensions/HealthCheckExtensions.cs` (`MapPlanoraHealthEndpoints`, `/health/live` + `/health/ready` + aggregate `/health`)
- `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Persistence/DatabaseStartup.cs` — schema bootstrap: applies migrations when present, creates from the EF model when absent
- `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Configuration/ConfigurationValidator.cs` — rejects weak JWT secrets and missing gRPC keys before the host binds a port
- `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Logging/TelemetryConfiguration.cs` (`AddPlanoraTelemetry` — single OpenTelemetry surface for every service)
- `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Observability/PlanoraMetrics.cs` (shared `Meter("Planora.BuildingBlocks")` exposing `planora.csrf.rejections`, `planora.grpc.unauthenticated`, `planora.outbox.*`)
- `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Security/SecurityStampValidator.cs`
- `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Grpc/ServiceKeyServerInterceptor.cs` / `ServiceKeyClientInterceptor.cs`
- `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Outbox/OutboxProcessor.cs`
- `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Resilience/DependencyWaiter.cs`
- `BuildingBlocks/Planora.BuildingBlocks.Application/Services/IBusinessEventLogger.cs`

## API Gateway

| Path | Purpose |
|---|---|
| `Planora.ApiGateway/Program.cs` | gateway startup, JWT validation, CORS, rate limiting, health, Ocelot |
| `Planora.ApiGateway/ocelot.json` | local route map |
| `Planora.ApiGateway/ocelot.Docker.json` | Docker route map |
| `Planora.ApiGateway/appsettings*.json` | gateway settings |
| `Planora.ApiGateway/Extensions` | Ocelot/gateway service registration |

## Auth Service

| Path | Purpose |
|---|---|
| `Services/AuthApi/Planora.Auth.Api` | HTTP controllers, gRPC service, filters, startup |
| `Services/AuthApi/Planora.Auth.Application` | auth/user/friendship commands, queries, handlers, validators, mappings |
| `Services/AuthApi/Planora.Auth.Domain` | user, role, refresh token, friendship, login history, password history domain model |
| `Services/AuthApi/Planora.Auth.Infrastructure` | EF Core context/configurations/repositories, token/password/email services, auditing, retention, event handlers |

Key controller files:

- `Controllers/AuthenticationController.cs`
- `Controllers/UsersController.cs`
- `Controllers/FriendshipsController.cs`
- `Controllers/AnalyticsController.cs`

Key security files:

- `Api/Filters/TokenBlacklistFilter.cs` — validates the security stamp on every authorized request
- `Infrastructure/Services/Security/SecurityStampService.cs`

Key persistence files:

- `Persistence/AuthDbContext.cs`
- `Persistence/Configurations/UserConfiguration.cs`
- `Persistence/Configurations/RefreshTokenConfiguration.cs`
- `Persistence/Configurations/FriendshipConfiguration.cs`

## Todo Service

| Path | Purpose |
|---|---|
| `Services/TodoApi/Planora.Todo.Api` | todo HTTP controller, gRPC service, startup |
| `Services/TodoApi/Planora.Todo.Application` | todo commands/queries, validators, DTOs, gRPC clients, hidden state logic |
| `Services/TodoApi/Planora.Todo.Domain` | todo item, share, worker, tag, viewer preference, enums, value objects |
| `Services/TodoApi/Planora.Todo.Infrastructure` | EF Core context/configurations/repositories, category/auth clients |

Critical files:

- `Controllers/TodosController.cs`
- `Features/Todos/Queries/GetUserTodos/GetUserTodosQueryHandler.cs`
- `Features/Todos/Queries/GetTodoById/GetTodoByIdQueryHandler.cs`
- `Features/Todos/Queries/GetPublicTodos/GetPublicTodosQueryHandler.cs`
- `Features/Todos/Queries/GetTodosByCategory/GetTodosByCategoryQueryHandler.cs`
- `Features/Todos/Queries/GetSubtasks/GetSubtasksQueryHandler.cs` — the only handler that populates `TodoItemDto.Workers` with live identities
- `Features/Todos/Commands/CreateTodo/CreateTodoCommandHandler.cs` — publishes `TaskCreatedIntegrationEvent`
- `Features/Todos/Commands/UpdateTodo/UpdateTodoCommandHandler.cs` — publishes `TaskActivityIntegrationEvent`
- `Features/Todos/Commands/JoinTodo/JoinTodoCommandHandler.cs`
- `Features/Todos/Commands/LeaveTodo/LeaveTodoCommandHandler.cs`
- `Features/Todos/Commands/DeleteTodo/DeleteTodoCommandHandler.cs` — publishes `TaskDeletedIntegrationEvent` (task) or `SubtaskDeletedIntegrationEvent` (subtask)
- `Features/Todos/Commands/SetTodoHidden/SetTodoHiddenCommandHandler.cs`
- `Features/Todos/Commands/SetViewerPreference/SetViewerPreferenceCommandHandler.cs`
- `Common/OutboxExtensions.cs` — helper to enqueue integration events in the unit of work
- `Features/Todos/TodoViewerStateResolver.cs`
- `Features/Todos/HiddenTodoDtoFactory.cs`
- `Api/Grpc/TodoGrpcService.cs` — includes `CheckTaskCommentAccess` (authorises Collaboration)
- `Domain/Entities/TodoItem.cs` — aggregate root with `Workers`, `RequiredWorkers`, `IsCapacityFull`, `CreateSubtask`, `SyncInheritedFromParent`
- `Domain/Entities/TodoItemWorker.cs`, `TodoItemShare.cs`, `TodoItemTag.cs`, `UserTodoViewPreference.cs`
- `Domain/Enums/TodoStatus.cs` (`Todo`, `InProgress`, `Done`), `TodoPriority.cs` (`VeryLow`…`Urgent` = 1…5)
- `Persistence/TodoDbContext.cs`
- `Persistence/Configurations/TodoItemWorkerConfiguration.cs`
- `Persistence/Configurations/OutboxMessageConfiguration.cs`

> The comment timeline is no longer in Todo — it lives in the **Collaboration Service** below.

## Collaboration Service

| Path | Purpose |
|---|---|
| `Services/CollaborationApi/Planora.Collaboration.Api` | comment HTTP controller, startup, integration-event subscriptions |
| `Services/CollaborationApi/Planora.Collaboration.Application` | comment commands/queries/validators, DTO, Inbox consumers, service ports |
| `Services/CollaborationApi/Planora.Collaboration.Domain` | `Comment` aggregate, domain event, repository contract |
| `Services/CollaborationApi/Planora.Collaboration.Infrastructure` | EF Core context/configuration/repository, Todo+Auth gRPC clients, outbox |

Critical files:

- `Api/Controllers/CommentsController.cs` — `/api/v1/comments` (get/add/genesis/update/delete)
- `Api/Program.cs` — subscribes to `TaskCreated`/`TaskActivity`/`TaskDeleted`/`SubtaskDeleted`/`UserDeleted`
- `Application/Features/Comments/Commands/*` — handlers + FluentValidation validators
- `Application/Features/Comments/Queries/GetComments/GetCommentsQueryHandler.cs`
- `Application/Features/IntegrationEvents/*EventConsumer.cs` — Inbox materialisation (idempotent)
- `Application/Services/ITaskAccessService.cs` / `IUserService.cs` — outward ports
- `Domain/Entities/Comment.cs` — `Create` / `CreateSystem` / `CreateGenesis` / `Update*`
- `Domain/Repositories/ICommentRepository.cs`
- `Infrastructure/Grpc/TaskAccessGrpcClient.cs` — wraps `TodoService.CheckTaskCommentAccess`
- `Infrastructure/Grpc/{UserGrpcService,CachingUserService}.cs` — avatar enrichment (60 s cache)
- `Infrastructure/Persistence/CollaborationDbContext.cs`
- `Infrastructure/Persistence/Configurations/CommentConfiguration.cs`

## Category Service

| Path | Purpose |
|---|---|
| `Services/CategoryApi/Planora.Category.Api` | category HTTP controller, gRPC service, startup |
| `Services/CategoryApi/Planora.Category.Application` | category commands/queries/validators/mappings, integration-event handlers |
| `Services/CategoryApi/Planora.Category.Domain` | category entity, colors, events |
| `Services/CategoryApi/Planora.Category.Infrastructure` | EF Core context/configuration/repository |

Critical files:

- `Controllers/CategoriesController.cs`
- `Domain/Enums/CategoryColors.cs`
- `Infrastructure/Persistence/CategoryDbContext.cs`
- `Infrastructure/Persistence/Configurations/CategoryConfiguration.cs`

## Messaging Service

| Path | Purpose |
|---|---|
| `Services/MessagingApi/Planora.Messaging.Api` | message HTTP controller, gRPC service, startup |
| `Services/MessagingApi/Planora.Messaging.Application` | send/get messages handlers and validators |
| `Services/MessagingApi/Planora.Messaging.Domain` | message domain entity |
| `Services/MessagingApi/Planora.Messaging.Infrastructure` | EF Core context/repositories/retention/event handlers |

Critical files:

- `Controllers/MessagesController.cs`
- `Features/Messages/Commands/SendMessage`
- `Features/Messages/Queries/GetMessages`
- `Infrastructure/Persistence/MessagingDbContext.cs`

## Realtime Service

| Path | Purpose |
|---|---|
| `Services/RealtimeApi/Planora.Realtime.Api` | controllers, SignalR hub mapping, realtime gRPC service, startup |
| `Services/RealtimeApi/Planora.Realtime.Application` | notification request/response contracts, handlers, integration-event cleanup, outward ports |
| `Services/RealtimeApi/Planora.Realtime.Domain` | `Notification`, `NotificationDelivery`, `NotificationDeliveryStatus` |
| `Services/RealtimeApi/Planora.Realtime.Infrastructure` | SignalR hub, connection manager, notification store/read-store, EF Core context, retention |

Critical files:

- `Api/Controllers/ConnectionsController.cs`
- `Api/Controllers/NotificationsController.cs`
- `Api/Grpc/RealtimeGrpcService.cs`
- `Api/Program.cs` — maps the single hub at `/hubs/notifications`
- `Application/Handlers/NotificationEventHandler.cs` / `RealtimeSyncEventHandler.cs`
- `Application/Features/IntegrationEvents/{TaskDeleted,UserDeleted}NotificationCleanupHandler.cs`
- `Infrastructure/Hubs/NotificationHub.cs` — the only SignalR hub in the product
- `Infrastructure/Grpc/TaskBranchAuthorizer.cs` — gates branch topic subscription against Todo
- `Infrastructure/Services/ConnectionManager.cs`, `RealtimeBroadcaster.cs`, `NotificationService.cs`, `NotificationStore.cs`, `NotificationReadStore.cs`
- `Infrastructure/Persistence/RealtimeDbContext.cs` — notifications and deliveries, with its own outbox table
- `Infrastructure/Retention/NotificationRetentionPolicies.cs`

## gRPC Contracts

| Path | Purpose |
|---|---|
| `GrpcContracts/Protos/auth.proto` | Auth service contract: token/user/friend checks, avatar batch |
| `GrpcContracts/Protos/category.proto` | Category contract used by Todo |
| `GrpcContracts/Protos/todo.proto` | Todo contract, including `CheckTaskCommentAccess` |
| `GrpcContracts/Protos/messaging.proto` | Messaging contract |
| `GrpcContracts/Protos/realtime.proto` | Realtime notification contract |

## Frontend

| Path | Purpose |
|---|---|
| `frontend/src/app` | Next.js App Router routes; `layout.tsx` declares `force-dynamic` for the whole tree |
| `frontend/src/middleware.ts` | mints the per-request CSP nonce and forwards it as `x-nonce` |
| `frontend/src/components/ui` | the primitives. Nothing here knows what a task is |
| `frontend/src/components/todos` | the task domain: cards, the create panel, the editor, the branch feed |
| `frontend/src/components/layout` | `navbar.tsx` — the shell and the phone bottom bar |
| `frontend/src/components/notifications` | the bell, its badge, and the badge cluster |
| `frontend/src/components/backgrounds` | the raw-WebGL ribbon gradient and its static fallback |
| `frontend/src/components/animated` | `celebration.tsx` (confetti), `fade-in.tsx`, `loading.tsx` |
| `frontend/src/components/*.tsx` | the headless singletons mounted near the root: `auth-guard`, `command-palette`, `error-boundary`, `motion-preferences-provider`, `realtime-manager`, `security-initializer` |
| `frontend/src/hooks` | cross-cutting behaviour: list navigation, focus trap, scroll lock, autosave, friends, collapse-on-scroll |
| `frontend/src/lib` | non-React: api client, tokens, animations, realtime, formatting, geometry |
| `frontend/src/store` | Zustand stores (`auth`, `notifications`, `toast`) |
| `frontend/src/types` | DTO shapes shared with the backend (`todo`, `auth`, `category`) |
| `frontend/src/utils` | pure helpers: sorting, category filter, completion window, deletion countdown |
| `frontend/src/test` | Vitest tests, mirroring the tree above; `test/quality/` holds the contract tests |
| `frontend/e2e` | Playwright: one API spec through the gateway, plus `e2e/ui/` browser specs |
| `frontend/next.config.js` | Next.js config, rewrites, static security headers |
| `frontend/tailwind.config.ts` | derives the whole theme from `lib/design-tokens.ts`; replaces Tailwind's own scales |
| `frontend/components.json` | shadcn/ui generator config |
| `frontend/eslint.config.mjs` | flat ESLint config |
| `frontend/playwright.config.ts` | Playwright e2e config |
| `frontend/vitest.config.ts` | Vitest config, including the 85% global coverage gate |

### Routes

| Path | Purpose |
|---|---|
| `app/layout.tsx` | fonts, CSP nonce consumer, providers, `ShortcutsHelp`, `force-dynamic` |
| `app/template.tsx` | per-navigation transition wrapper |
| `app/globals.css` | the focus indicator, `.touch-target`, reduced-motion collapse, `--pl-*` variables |
| `app/page.tsx` | landing |
| `app/dashboard/page.tsx` | overview: `StatRow`, `WeekBars`, the `pathLength` progress ring, quick capture, undo-window delete |
| `app/tasks/page.tsx` | the working list: masonry cards, `useListNavigation`, `SelectionBar`, `UpdatePill`, quick capture, undo-window delete |
| `app/tasks/completed/page.tsx` | the archive, with the completion-date filter inside the QuickFilter plate |
| `app/branch/[id]/page.tsx` | the same full task editor the modal shows, on its own URL so a card can be opened in a new tab |
| `app/categories/page.tsx` | category management |
| `app/profile/page.tsx` | identity, security, sessions, history, circle |
| `app/auth/*/page.tsx` | login, register, verify-email, forgot-password, reset-password |

`dashboard`, `tasks`, `categories` and `profile` each ship an `error.tsx` (rendering `SegmentError`)
and a `loading.tsx` beside the page. `tasks/completed`, `branch/[id]` and the `auth/*` routes carry
a `layout.tsx` only — a gap worth closing rather than a convention.

### `components/ui` — the primitives

| File | What it is |
|---|---|
| `autosave-indicator.tsx` | the only signal that an autosaving form reached the server |
| `avatar.tsx` | image or initials, at the four sanctioned diameters |
| `button.tsx` | the button variants and control heights |
| `card.tsx` | the card surface |
| `confirm-dialog.tsx` | confirmation, with an optional "don't ask again" checkbox. Reserved for what the undo window cannot cover |
| `dropdown-menu.tsx` | Radix dropdown wrapper |
| `field.tsx` | label, control, hint and error wired together once; exports `FIELD_LABEL_CLASS` |
| `icon-picker.tsx` | the category icon grid |
| `ink-check.tsx` | the completion mark, drawn rather than popped |
| `input.tsx`, `textarea.tsx` | the text controls |
| `masonry-columns.tsx` | the responsive column layout the task list is built on |
| `modal-portal.tsx` | portal target for dialogs |
| `number-roll.tsx` | `NumberRoll` — digits that roll so the direction of change is legible |
| `overlay.tsx` | everything a modal owes its reader: role, focus trap, scroll lock, Escape |
| `presence-row.tsx` | `PresenceRow` + `usePresenceArrivals` — who is in a task, as faces; an arrival as an event |
| `priority-meter.tsx` | priority as a five-segment meter in one ink colour |
| `redaction-badge.tsx` | `RedactionBadge` + `redactionArc` — audience as an arc that opens and closes |
| `segment-error.tsx` | the shared body of every route segment's `error.tsx` |
| `selection-bar.tsx` | bulk actions over a gathered selection, count before the verb |
| `shortcuts-overlay.tsx` | the `?` map; exports `SHORTCUT_GROUPS`, `MOD`, `formatKey`, `useIsApplePlatform`, `ShortcutsHelp` |
| `stat-row.tsx` | the dashboard's live facts, each one a filter you can press |
| `status-panel.tsx` | the one shape every empty, loading and error panel takes |
| `toast.tsx` | the toast surface, one per semantic colour |
| `undo-bar.tsx` | `UndoBar` + `useUndoableAction`; exports `UNDO_WINDOW_MS` (5000) |
| `update-pill.tsx` | `UpdatePill` + `useDeferredUpdates` — somebody else's change, offered rather than applied |
| `week-bars.tsx` | seven days of completions, as bars |

### `components/todos` — the task domain

| File | What it is |
|---|---|
| `advanced-search-bar.tsx` | text search plus status/priority narrowing over a loaded task array |
| `category-filter-modal.tsx` | the category picker used by the quick filter |
| `create-todo-panel.tsx` | the full create surface: title plus the four selector plates (priority, due date, category, share) |
| `date-filter-popover.tsx` | the completion-date filter, opened as a floating popover from inside the QuickFilter plate |
| `friend-multi-select.tsx` | the audience picker |
| `quick-capture.tsx` | the 56×56 thumb-zone capture button: one field, one key, and it owns the bare `c` |
| `quick-filter-bar.tsx` | the QuickFilter plate shared by `/tasks` and `/tasks/completed` |
| `task-comments.tsx` | the standalone comment list (2000-character limit) |
| `task-deletion-badge.tsx` | the "deletes in N days" pill on a completed task |
| `todo-card.tsx` | the card: the product's main object. Records the shared origin on press |
| `todo-skeleton.tsx` | the card-shaped loading placeholder |
| `worker-join-button.tsx` | Join / Leave / Full, for taking a task into work |
| `edit-todo-modal.tsx` | legacy re-export bridging `@/components/todos/edit-todo-modal` to the folder below |
| `edit-todo-modal/modal.tsx` | the editor dialog; consumes the shared origin, carries presence and redaction in its header |
| `edit-todo-modal/branch-feed.tsx` | the branch timeline: messages, replies, subtasks, the composer |
| `edit-todo-modal/page-meta-panel.tsx` | the desktop meta column |
| `edit-todo-modal/inline-token-strip.tsx` | the inline priority/date/category/visibility strip |
| `edit-todo-modal/popover.tsx`, `popovers/*` | the anchored pickers (category, date, priority, visibility) |
| `edit-todo-modal/color-picker.tsx`, `utils.ts` | `@colour-data` — the HSL wheel and the twelve category swatches |
| `edit-todo-modal/friend-avatar.tsx` | one participant's face in the editor |

### `hooks`

| File | What it is |
|---|---|
| `use-autosave.ts` | one autosave channel with `idle` / `saving` / `saved` / `error` |
| `use-collapse-scroll.ts` | height-locked collapse that does not let the page jump |
| `use-focus-trap.ts` | remembers focus, traps Tab inside a dialog, restores it on close |
| `use-friends.ts` | the shared friend cache; `invalidateFriends()` after any mutation |
| `use-list-navigation.ts` | the keyboard cursor and multi-selection over a list of ids |
| `use-scroll-lock.ts` | counted, not boolean — two open overlays must not unlock on the first close |

### `lib`

| File | What it is |
|---|---|
| `analytics.ts` | `PRODUCT_EVENTS` and `trackProductEvent` |
| `animations.ts` | motion presets; the numbers come from `design-tokens.ts`, never from here |
| `api.ts` | the axios instance, every endpoint wrapper, the refresh/backoff interceptors |
| `auth-broadcast.ts` | cross-tab logout over `BroadcastChannel` |
| `auth-public.ts` | the unauthenticated auth calls, with refresh de-duplication |
| `config.ts` | `getApiBaseUrl()` — resolves the gateway against the host the page was opened from |
| `csrf.ts` | the double-submit token: read the cookie, echo the header |
| `datetime.ts` | all date formatting, with the locale pinned so SSR and hydration agree |
| `design-tokens.ts` | the single source of truth for every visual value; `tailwind.config.ts` derives from it |
| `errors.ts` | failure classification and the copy for refusals a user cannot act their way out of |
| `events.ts` | the custom window events (`planora:task-created`, the create-panel open event) |
| `friend-names.ts` | id → display name, resolved from the shared friend cache |
| `haptics.ts` | tiny vibration patterns for completion and creation only |
| `icon-map.ts` | `@colour-data` — default icon and colour for a new category |
| `jwt.ts` | decode only. Verification is the gateway's job |
| `notifications/types.ts` | `@colour-data` — per-notification-type tints |
| `notifications/web-notifications.ts` | OS notification permission and delivery |
| `realtime/client.ts` | the SignalR client and its payload types |
| `realtime/hooks.ts` | connection lifecycle and the per-topic subscriptions (`useFeedSync` and friends) |
| `shared-origin.ts` | the card→dialog transition geometry: `rememberOrigin`, `takeOrigin`, `originTransform`, `editorDialogRect` |
| `subtask-warning.ts` | the copy and predicates for "finish a task that still has open subtasks?" |
| `trace.ts` | the W3C `traceparent` header for the browser→gateway boundary |
| `ui-preferences.ts` | SSR-safe localStorage preferences; never security- or correctness-relevant |
| `utils.ts` | `cn()` plus `@colour-data` WCAG luminance arithmetic |

### `utils`

| File | What it is |
|---|---|
| `category-filter.ts` | the per-user persisted category filter |
| `completion-window.ts` | picker selection → inclusive `completedFrom` / `completedTo` |
| `deletion-countdown.ts` | mirrors the backend retention default for the archive's "deletes in N days" hint |
| `sort-tasks.ts` | the task ordering used by every list |
| `todo-utils.ts` | `applyCategoryPatch` — folds a category change into a task without dropping the fields the patch does not carry |

## Tests

| Path | Purpose |
|---|---|
| `tests/Planora.UnitTests` | unit and contract tests for building blocks and services, including the security-stamp, JWT-wiring and runtime contract suites |
| `tests/Planora.ErrorHandlingTests` | middleware/error-handling and integration-style checks |
| `frontend/src/test/components` | component tests, including `presence-row`, `redaction-badge`, `update-pill`, `selection-bar`, `shortcuts-overlay`, `quick-capture` |
| `frontend/src/test/hooks` | hook tests, including `use-list-navigation` |
| `frontend/src/test/lib`, `store`, `types`, `utils`, `app` | the rest of the frontend suite |
| `frontend/src/test/quality` | the contract tests: `design-tokens.contract.test.ts` and `usability-contract.test.tsx` |
| `frontend/e2e/auth-todos-sharing-hidden.api.spec.ts` | Docker-backed auth/sharing/hidden flow through the API Gateway |
| `frontend/e2e/ui` | browser specs for the five auth routes, profile update, and the tasks page |

## Documentation

| Path | Purpose |
|---|---|
| `docs/index.md` | documentation navigation |
| `docs/INVARIANTS.md` | closed-form architectural invariants |
| `docs/glossary.md` | every term with a specific meaning, and the forbidden synonyms |
| `docs/architecture.md`, `docs/overview.md` | service topology and the system in one read |
| `docs/API.md` | every HTTP endpoint: method, auth, body, response shape, errors |
| `docs/features.md` | confirmed behaviour per feature with implementation pointers |
| `docs/database.md` | DB ownership, entities, schema bootstrap, migration list |
| `docs/frontend.md`, `docs/design-system.md` | the frontend's conventions and the visual system |
| `docs/auth-security.md`, `docs/security-idor-coverage.md` | auth flow, CSRF, stamp rotation, per-endpoint IDOR coverage |
| `docs/configuration.md`, `docs/caching.md`, `docs/testing.md` | env vars, cache policy, test strategy |
| `docs/observability.md`, `docs/slo.md`, `docs/OPERATIONS.md` | telemetry, objectives, runbooks |
| `docs/deployment.md`, `docs/production.md`, `docs/secrets-management.md` | deployment and secret-management baseline |
| `docs/getting-started.md`, `docs/development.md`, `docs/troubleshooting.md`, `docs/faq.md` | onboarding and day-to-day |
| `docs/DECISIONS` | architecture decision records (`0001`–`0006`) |
| `docs/ui-audit` | the interface audit: `RESEARCH.md`, `DEFECTS.md`, `TARGET.md`, `BLUEPRINT.md`, `EXECUTION.md`, `RESULTS.md`, `INVENTORY.md`, plus `tools/` (the scanners) and `shots/` |
| `docs/eco`, `docs/plans` | product research and dated plans |
| `ARCHITECTURE.md`, `SECURITY.md`, `TESTING.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, `AGENTS.md` | root-level summaries and contributor-facing docs |
| `LICENSE` | MIT license |
