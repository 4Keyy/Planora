# Overview

Planora is a personal productivity and sharing system. The visible product is a Next.js web app; the backend is split into .NET 10 services behind an Ocelot API Gateway.

The core workflow is:

1. A user registers or logs in.
2. The frontend keeps the access token in memory and relies on an httpOnly refresh cookie for session restoration.
3. The user creates categories and todos.
4. Todos can be private or shared with accepted friends.
5. A shared todo can be hidden per viewer; hidden shared/public todos are redacted by the backend.
6. Friends can exchange messages and receive realtime notifications.

## Product Scope Confirmed By Code

| Capability | Status | Evidence |
|---|---|---|
| User registration and login | implemented | `Services/AuthApi/Planora.Auth.Api/Controllers/AuthenticationController.cs` |
| Access/refresh token lifecycle | implemented | `AuthenticationController.cs`, `frontend/src/store/auth.ts`, `frontend/src/lib/auth-public.ts` |
| CSRF double-submit token | implemented | `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Middleware/CsrfProtectionMiddleware.cs`, `frontend/src/lib/csrf.ts` |
| Profile and account security | implemented | `Services/AuthApi/Planora.Auth.Api/Controllers/UsersController.cs` |
| Two-factor authentication | implemented | `UsersController.cs`, `Services/AuthApi/Planora.Auth.Application/Features/Users/Commands/*2FA` |
| Friend requests and friendships | implemented | `Services/AuthApi/Planora.Auth.Api/Controllers/FriendshipsController.cs` |
| Category CRUD | implemented | `Services/CategoryApi/Planora.Category.Api/Controllers/CategoriesController.cs` |
| Todo CRUD and filtering | implemented | `Services/TodoApi/Planora.Todo.Api/Controllers/TodosController.cs` |
| Shared todo hidden/viewer preferences | implemented | `Services/TodoApi/Planora.Todo.Application/Features/Todos/HiddenTodoDtoFactory.cs`, `TodoViewerStateResolver.cs` |
| Task comment timeline | implemented | `Services/CollaborationApi/Planora.Collaboration.Api/Controllers/CommentsController.cs` |
| Direct messages | implemented | `Services/MessagingApi/Planora.Messaging.Api/Controllers/MessagesController.cs` |
| Realtime notification primitives | implemented | `Services/RealtimeApi/Planora.Realtime.Api/Controllers`, `Services/RealtimeApi/Planora.Realtime.Api/Hubs` |
| Durable notifications (offline catch-up, unread counts) | implemented, conditional on `ConnectionStrings__RealtimeDatabase` | `Services/RealtimeApi/Planora.Realtime.Domain/Entities/Notification.cs`, `Services/RealtimeApi/Planora.Realtime.Infrastructure/Persistence/RealtimeDbContext.cs` |
| Keyboard-driven task list, command palette, quick capture | implemented | `frontend/src/components/command-palette.tsx`, `frontend/src/components/ui/shortcuts-overlay.tsx`, `frontend/src/components/todos/quick-capture.tsx` |
| Undo window in place of a delete confirmation | implemented | `frontend/src/components/ui/undo-bar.tsx` (`UNDO_WINDOW_MS` = 5000), `frontend/src/app/tasks/page.tsx`, `frontend/src/app/dashboard/page.tsx` |
| Product analytics event intake | implemented as structured business logging, not third-party analytics | `Services/AuthApi/Planora.Auth.Api/Controllers/AnalyticsController.cs`, `BuildingBlocks/Planora.BuildingBlocks.Application/Services/IBusinessEventLogger.cs` |

## Audiences

Planora documentation is written for four groups:

| Audience | What they need |
|---|---|
| User | Understand what the app does and how to run it locally. |
| New developer | Understand service boundaries, frontend flow, API routes, and data ownership. |
| Experienced engineer | Evaluate architecture, failure modes, security model, database boundaries, and extension points. |
| Contributor | Know how to add features safely and what tests/checks to run. |

## Domain Model

Every first-class entity belongs to exactly one service and lives in that service's database.
Entities in different services reference each other by bare `Guid` only — there is no foreign key,
no join, and no shared table. A task carries a `CategoryId` but cannot read the category row; a
comment carries a `TaskId` but the Collaboration service owns no task.

Most entities derive from `BaseEntity` (`BuildingBlocks/Planora.BuildingBlocks.Domain/BaseEntity.cs`),
which supplies `Id`, `CreatedAt`/`CreatedBy`, `UpdatedAt`/`UpdatedBy`, and the soft-delete triple
`IsDeleted`/`DeletedAt`/`DeletedBy`. The pure join rows — shares, workers, tags, viewer
preferences, user-role rows — do not: they are keyed by their pair and carry nothing else.

### Auth — `planora_auth_db`

`Services/AuthApi/Planora.Auth.Domain/Entities/`

| Entity | What it is | What owns it → what it owns |
|---|---|---|
| `User` | The account. Holds an `Email` value object, the PBKDF2 hash, first/last name, avatar URL, status, email-verification and password-reset tokens with expiries, failed-login counters and lockout windows, and the TOTP secret | Owned by nobody → owns its `UserRole`, `RefreshToken`, `UserRecoveryCode`, `LoginHistory`, and `PasswordHistory` rows |
| `Role` | A named role with an optional description | Owned by nobody → owns nothing; reached through `UserRole` |
| `UserRole` | The join row between a user and a role | Owned by the pair → owns nothing |
| `RefreshToken` | The server-side half of a rotating session. Records the issuing IP, expiry, `RememberMe`, device fingerprint and name, login count, and — when rotated or revoked — `ReplacedByToken`, `RevokedAt`, `RevokedByIp`, `RevokedReason` | Owned by a `User` → owns nothing |
| `UserRecoveryCode` | One hashed, single-use 2FA recovery code with its spent state | Owned by a `User` → owns nothing |
| `LoginHistory` | One row per login attempt: IP, user agent, success flag, failure reason, timestamp | Owned by a `User` → owns nothing |
| `PasswordHistory` | A previous password hash with the date it was replaced | Owned by a `User` → owns nothing |
| `Friendship` | The relation itself: requester, addressee, status, and the requested/accepted/rejected timestamps | Owned by the pair of users → owns nothing, but gates every share in the Todo service |

### Todo — `planora_todo`

`Services/TodoApi/Planora.Todo.Domain/Entities/`

| Entity | What it is | What owns it → what it owns |
|---|---|---|
| `TodoItem` | The task, and the aggregate root. Title, description, status, priority, `IsPublic`, the estimated-completion date or interval (`DueDateStart` ≤ `DueDate`, both enforced in the domain), `ExpectedDate`/`ActualDate`, `RequiredWorkers`, and `CreatedByUserId` for subtasks added by a collaborator | Owned by a user (`UserId`) → owns its `TodoItemTag`, `TodoItemShare`, and `TodoItemWorker` rows, and its subtasks through `ParentTodoId` |
| `TodoItemTag` | A free-text label on one task, unique per task case-insensitively | Owned by a `TodoItem` → owns nothing |
| `TodoItemShare` | `(TodoItemId, SharedWithUserId)` — one named friend who can see the task. Replacing the set evicts any worker who lost access | Owned by a `TodoItem` → owns nothing |
| `TodoItemWorker` | `(TodoItemId, UserId, JoinedAt)` — somebody who took the task into work. The owner of a normal task never holds one; on a subtask everybody, owner included, opts in | Owned by a `TodoItem` → owns nothing |
| `UserTodoViewPreference` | `(ViewerId, TodoItemId)` with `HiddenByViewer`, `ViewerCategoryId`, `CompletedByViewer`, `CompletedByViewerAt`. The viewer's private opinion of somebody else's task | Owned by the viewer, not by the task → owns nothing |

A subtask is a `TodoItem` with `ParentTodoId` set. It belongs to the parent's owner regardless of
who added it, inherits the parent's category, `IsPublic` flag and share list, never carries a date,
and cannot itself have subtasks.

### Category — `planora_category`

| Entity | What it is | What owns it → what it owns |
|---|---|---|
| `Category` | A user's own label: name, description, colour, icon, display order, archived flag | Owned by a user (`UserId`) → owns its `SubCategories` through `ParentCategoryId` |

`Services/CategoryApi/Planora.Category.Domain/Entities/Category.cs`. The parent/child relation
exists in the domain; the product does not surface it — see
[What Planora Deliberately Does Not Do](#what-planora-deliberately-does-not-do).

### Collaboration — `planora_collaboration`

| Entity | What it is | What owns it → what it owns |
|---|---|---|
| `Comment` | One entry on a task's timeline, in three flavours: a user comment, the genesis comment (the author's note that opens the branch), and an auto-generated system event. A reply additionally snapshots its target's type, id, author, and a preview capped at 300 characters, plus a `ReplyToDeleted` flag | Owned by a task in another service, by `TaskId` alone → owns nothing |

`Services/CollaborationApi/Planora.Collaboration.Domain/Entities/Comment.cs`. Every read and write
is authorised against the Todo service over gRPC, because this service cannot see the task.

### Messaging — `planora_messaging`

| Entity | What it is | What owns it → what it owns |
|---|---|---|
| `Message` | A direct message: subject, body, sender, recipient, `ReadAt`, `IsArchived`, and an `AttachmentUrls` JSON string that the API never populates | Owned by the sender/recipient pair → owns nothing |

### Realtime — `planora_realtime`

`Services/RealtimeApi/Planora.Realtime.Domain/Entities/`

| Entity | What it is | What owns it → what it owns |
|---|---|---|
| `Notification` | The durable record of one notification consumed from the event bus: recipient, title, body, type, `TaskId` and `ActorId` for routing and attribution, read state, and `SourceEventId` — unique, which is what makes redelivery idempotent | Owned by a recipient (`UserId`) → owns its `NotificationDelivery` rows |
| `NotificationDelivery` | The per-user delivery audit for one notification: status, attempt count, delivery time, last error | Owned by a `Notification` → owns nothing |

Persistence is conditional on `ConnectionStrings__RealtimeDatabase`. Without it the service still
runs and still pushes over SignalR, but nothing is stored and the read API returns empty.

### Across Services

| Concept | Meaning | Code |
|---|---|---|
| Integration event | A RabbitMQ-delivered message used for async cross-service work — task lifecycle, category deletion, friendship removal, account state | `BuildingBlocks/Planora.BuildingBlocks.Application/Messaging/Events/` |
| Outbox message | The event as written inside the business transaction, dispatched afterwards by a signal-driven processor with a polling safety net | `BuildingBlocks/Planora.BuildingBlocks.Application/Outbox/`, `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Outbox/` |
| Inbox message | The consumer-side record that makes handling an event twice a no-op | `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Inbox/` |

The browser sees a flattened view of all of this: `frontend/src/types/todo.ts` folds the task, its
category, its author, its workers, and the viewer's own completion state into one `Todo` object,
and `frontend/src/types/auth.ts` does the same for the account, its sessions, and its friends.

## The Two Devices

Planora is used on a phone and on a desktop, and they are not the same product at different widths.
The phone is the device of the hands: somebody captures a thought while standing up and glances at
what is late, so every primary control sits in the bottom band the thumb can reach and capture is
one key or one tap away. The desktop is the device of the head: the same person sits down, plans,
and works a list, so the keyboard is the primary interface — a command palette, a cursor that moves
on `J`/`K`, priority on `1`–`5`, and a `?` map that prints every binding. The full model, including
the reachability bands and where the phone measurably runs out of room, is in
[`design-system.md` § The two devices](design-system.md#13-the-two-devices).

## Main User Scenarios

### Manage Personal Tasks

The user creates categories, creates todos, assigns category/priority/dates, filters active tasks, and views completed tasks. The frontend pages are `frontend/src/app/tasks/page.tsx`, `frontend/src/app/tasks/completed/page.tsx`, `frontend/src/app/dashboard/page.tsx`, and `frontend/src/app/categories/page.tsx`; backend behavior is in `TodosController.cs` and `CategoriesController.cs`.

Most of this is reachable without the mouse: `C` opens quick capture on every screen that has it, `⌘K` / `Ctrl K` opens the command palette — whose one creation entry is the same "Capture a task" — and the task list answers `J`/`K`, `G G`, `Shift G`, `Enter`, `Space`, `E`, `1`–`5`, `X`, and `Delete`. `?` prints the whole map. See [`features.md` § The keyboard over the task list](features.md#the-keyboard-over-the-task-list).

### Share Tasks With Friends

The user sends a friend request, the other user accepts, and then todos can be shared with accepted friends. The frontend exposes all-friends visibility inside `Share With`, while selected-friend sharing persists `TodoItemShare` rows. Todo creation/update checks the accepted friend list via Auth gRPC before persisting direct shares.

`IsPublic` on a task means "every accepted friend", not "the internet": `GetPublicTodosQueryHandler` resolves the viewer's friend list over gRPC first and only ever returns tasks owned by those friends. The task editor writes `isPublic: false` on every save and expresses reach through the named-share list instead, which is why its visibility token reads `private`, `all friends`, or `shared · N` and never `public`.

Implementation:

- `Services/AuthApi/Planora.Auth.Api/Controllers/FriendshipsController.cs`
- `Services/TodoApi/Planora.Todo.Application/Features/Todos/Commands/CreateTodo/CreateTodoCommandHandler.cs`
- `Services/TodoApi/Planora.Todo.Application/Features/Todos/Commands/UpdateTodo/UpdateTodoCommandHandler.cs`
- `GrpcContracts/Protos/auth.proto`

### Hide A Shared Task

For shared/public tasks, hidden state is viewer-specific. A hidden shared task returns a redacted DTO with title `Hidden task`, empty/default sensitive fields, preserved viewer category metadata, and non-content visual state for shared/urgent card frames. This is enforced in the backend by `HiddenTodoDtoFactory`, not only in the UI.

Implementation:

- `Services/TodoApi/Planora.Todo.Application/Features/Todos/TodoViewerStateResolver.cs`
- `Services/TodoApi/Planora.Todo.Application/Features/Todos/HiddenTodoDtoFactory.cs`
- `Services/TodoApi/Planora.Todo.Application/Features/Todos/Commands/SetViewerPreference/SetViewerPreferenceCommandHandler.cs`
- `frontend/src/app/tasks/page.tsx`

### Restore A Browser Session

The frontend persists user metadata and expiration timestamps in session storage, but not the raw access token or refresh token. On reload, it validates the in-memory token if present or calls the refresh endpoint using the httpOnly cookie.

Implementation:

- `frontend/src/store/auth.ts`
- `frontend/src/lib/auth-public.ts`
- `Services/AuthApi/Planora.Auth.Api/Controllers/AuthenticationController.cs`

## Current Boundaries

Confirmed service ownership:

- Auth owns users, roles, sessions, refresh tokens, login history, password history, friendships, audit logs, and auth-side outbox/inbox tables.
- Todo owns todo items, tags, shares, and viewer preferences, and publishes task-lifecycle events via its outbox.
- Category owns categories.
- Messaging owns messages and messaging-side outbox/inbox tables.
- Collaboration owns the task comment timeline (user/genesis/system comments) and authorises every operation against Todo over gRPC; it never reads Todo's database.
- Realtime owns SignalR connection state on the Redis backplane and, in `planora_realtime`, the durable notification read-model (`Notifications`, `NotificationDeliveries`, plus its own outbox).
- Gateway owns public routing and ingress-level JWT/rate/CORS behavior.

## What Planora Deliberately Does Not Do

Each of these is a decision visible in the code, not a gap waiting to be filled.

| Not supported | How the code says so |
|---|---|
| **Publishing anything to the open internet.** Sharing stops at the friend graph | `GetPublicTodosQueryHandler` resolves the viewer's accepted-friend list over gRPC before it reads a single row; the editor writes `isPublic: false` on every save (`frontend/src/components/todos/edit-todo-modal/utils.ts`) |
| **A dark theme.** The product ships one palette | `frontend/src/app/globals.css` defines its tokens on `:root` only, with no `.dark` block and no `prefers-color-scheme` branch; `tailwind.config.ts` sets `darkMode: ["class"]` but no source file uses a `dark:` utility |
| **Restoring a deleted task.** Delete is final once the undo window closes | `TodosController` exposes `DELETE /{id}` and no inverse. `BaseEntity.Restore()` exists but nothing in the Todo service calls it, and the retention purge removes soft-deleted rows for good after `SoftDeleteGraceDays` |
| **Nested subtasks.** The tree is exactly two levels deep | `TodoItem.CreateSubtask` throws `BusinessRuleViolationException` when the parent is itself a subtask |
| **Category hierarchies in the product.** Categories are a flat list | `Category` carries `ParentCategoryId` and `SubCategories`, but `frontend/src/types/category.ts` has no parent field and no surface sets one |
| **Recurring tasks and reminders.** A task has dates, not a schedule | No recurrence rule, repeat field, or due-date notifier exists anywhere in `Services/TodoApi` |
| **File attachments on tasks or messages.** The only upload in the product is an avatar | `IFormFile` appears twice in the whole solution — the `UsersController.UploadAvatar` parameter and the `UploadAvatarCommand` that carries it, which are the two halves of one avatar upload; `Message.AttachmentUrls` is a column the API never writes |
| **Third-party analytics.** Events are allowlisted and logged, never shipped out | `AnalyticsController.cs` hands events to `IBusinessEventLogger`; no SDK, no analytics table |

## Confirmed Limitations

| Limitation | Evidence |
|---|---|
| Production hosting target and deploy automation are not committed. | `docker-compose.yml`, `.github/workflows/ci.yml`, `.github/workflows/e2e.yml` |
| No external analytics SDK/table was found; analytics events are allowlisted and logged through business logging. | `AnalyticsController.cs`, `IBusinessEventLogger.cs`, `frontend/src/lib/analytics.ts` |
| Realtime persistence is optional: without `ConnectionStrings__RealtimeDatabase` the service falls back to ephemeral SignalR pushes and an empty read API. | `Services/RealtimeApi/Planora.Realtime.Infrastructure/Persistence/RealtimeDbContext.cs`, `docker-compose.yml` |
| Gateway route docs must include both canonical friendship route and legacy `/friendships` route because both are present in Ocelot and frontend code uses the legacy route. | `Planora.ApiGateway/ocelot.json`, `frontend/src/hooks/use-friends.ts` |
