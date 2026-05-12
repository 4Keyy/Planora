# Features

This reference describes confirmed Planora behavior and points each feature back to implementation files.

## Authentication And Session Lifecycle

### Purpose

Register users, log in, maintain browser sessions, rotate refresh tokens, log out, and restore sessions after page reload.

### User Flow

1. User fetches CSRF token.
2. User registers or logs in.
3. Auth API returns an access token in JSON and sets an httpOnly refresh cookie.
4. Frontend stores access token in memory and user metadata in session storage.
5. On `401`, frontend refreshes once using the cookie, rotates the refresh token, and retries the request.
6. Logout revokes the server-side refresh token when possible and always deletes the cookie.

### Implementation

- `Services/AuthApi/Planora.Auth.Api/Controllers/AuthenticationController.cs`
- `Services/AuthApi/Planora.Auth.Application/Features/Authentication`
- `frontend/src/lib/auth-public.ts`
- `frontend/src/lib/api.ts`
- `frontend/src/store/auth.ts`
- `docs/DECISIONS/0002-http-only-refresh-cookies.md`

### Key Rules

| Rule | Source |
|---|---|
| Refresh token is not returned in login/register/refresh JSON. | `AuthenticationController.cs` |
| Refresh token cookie path is `/auth/api/v1/auth`. | `AuthenticationController.cs` |
| Persistent refresh cookie is used only when `rememberMe` is true. | `AuthenticationController.Login`, `RefreshToken` |
| Access token is not persisted by the frontend store. | `frontend/src/store/auth.ts` |
| Refresh uses a separate public auth client to avoid interceptor recursion. | `frontend/src/lib/auth-public.ts` |

### Edge Cases

- Missing refresh cookie returns `204 No Content` so silent restore can fail without a browser console error.
- Invalid refresh clears the cookie.
- CSRF is still required for state-changing anonymous auth endpoints.

## CSRF Protection

### Purpose

Protect browser state-changing requests that rely on cookies.

### Implementation

- `GET /auth/api/v1/auth/csrf-token` in `AuthenticationController.cs`
- `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Middleware/CsrfProtectionMiddleware.cs`
- `frontend/src/lib/csrf.ts`

### Key Rules

- CSRF validation applies to `POST`, `PUT`, `PATCH`, and `DELETE`.
- gRPC requests are excluded.
- The middleware compares `X-CSRF-Token` header and `XSRF-TOKEN` cookie with constant-time comparison.

## Profile, Security, And 2FA

### Purpose

Let users manage profile data, password/email changes, email verification, sessions, login history, and TOTP-based 2FA.

### Implementation

- `Services/AuthApi/Planora.Auth.Api/Controllers/UsersController.cs`
- `Services/AuthApi/Planora.Auth.Application/Features/Users`
- `Services/AuthApi/Planora.Auth.Infrastructure/Services/Authentication/PasswordValidator.cs`
- `frontend/src/app/profile/page.tsx`

### Key Rules

| Area | Behavior |
|---|---|
| Profile update | `firstName` and `lastName` required, max 100; profile picture URL max 500 and must be absolute HTTP/HTTPS if present. |
| Password strength | min 8, max 128, uppercase, lowercase, digit, special char; also weak/sequential/repeating checks in infrastructure. |
| Email verification | registration/change-email create a 24-hour token; `GET /auth/api/v1/users/verify-email?token=...` confirms it; profile `POST /me/verify-email` sends a fresh link for the signed-in user. `Email__Provider=GmailSmtp` sends real Gmail messages; default `Log` provider writes links to Auth API logs. User DTOs expose `isEmailVerified` and `emailVerifiedAt`. |
| Compromised password check | HIBP k-anonymity lookup is enabled by config default in `PasswordValidator`; lookup failure logs and does not block. |
| 2FA | enable returns setup data, confirm requires a 6-digit code, disable requires password. |
| Admin users | admin-only user list/statistics/detail endpoints exist. |

### Frontend Behavior

- The profile route presents account work as a single responsive profile center: a summary header, horizontal-on-mobile/side-on-desktop section navigation, and animated panels for identity, security, sessions, login history, friends, and admin tools.
- Profile panels use calm opacity/position transitions through `framer-motion` and keep existing Auth API calls for profile update, password/email changes, email verification, 2FA setup, session revocation, friend requests, and admin user lookup.
- Character-limited profile fields use the shared input counter and warning styling used elsewhere in the frontend.

## Friendships

### Purpose

Establish social relationships required for task sharing and friend-scoped task visibility.

### Implementation

- `Services/AuthApi/Planora.Auth.Api/Controllers/FriendshipsController.cs`
- `Services/AuthApi/Planora.Auth.Application/Features/Friendships`
- `Services/AuthApi/Planora.Auth.Domain/Entities/Friendship.cs`
- `GrpcContracts/Protos/auth.proto`
- `frontend/src/app/profile/page.tsx`
- `frontend/src/hooks/use-friends.ts`

### Key Rules

- Friend requests can be sent by `friendId` or by email.
- Email invite response is intentionally generic: "If that email can receive friend requests..."
- Incoming/outgoing requests are controlled with `incoming=true/false`.
- Internal friend-id and are-friends checks return safe fallback values on exceptions.
- Gateway exposes both `/auth/api/v1/friendships*` and legacy `/friendships*`.

## Categories

### Purpose

Organize todos with user-owned labels that carry color, icon, and display order.

### Implementation

- `Services/CategoryApi/Planora.Category.Api/Controllers/CategoriesController.cs`
- `Services/CategoryApi/Planora.Category.Application/Features/Categories`
- `Services/CategoryApi/Planora.Category.Domain/Entities/Category.cs`
- `Services/CategoryApi/Planora.Category.Domain/Enums/CategoryColors.cs`
- `frontend/src/app/categories/page.tsx`

### Key Rules

| Field | Rule |
|---|---|
| `name` | required, max 50 |
| `description` | optional, max 500 |
| `color` | optional; must be a predefined color or `#` plus 6 alphanumeric characters |
| `icon` | optional string |
| `displayOrder` | defaults to 0 |

### Edge Cases

- Delete returns `404` for `CATEGORY_NOT_FOUND`.
- Delete returns `403` for forbidden access.
- Category deletion emits integration behavior consumed by Todo; see `Services/TodoApi/Planora.Todo.Application/Features/Todos/Events/CategoryDeletedEventHandler.cs`.

## Todos

### Purpose

Create, update, delete, complete, filter, share, hide, and categorize tasks.

### Implementation

- `Services/TodoApi/Planora.Todo.Api/Controllers/TodosController.cs`
- `Services/TodoApi/Planora.Todo.Application/Features/Todos`
- `Services/TodoApi/Planora.Todo.Domain/Entities/TodoItem.cs`
- `Services/TodoApi/Planora.Todo.Domain/Enums`
- `frontend/src/app/todos/page.tsx`
- `frontend/src/app/todos/completed/page.tsx`

### Key Rules

| Area | Behavior |
|---|---|
| Title | required on create, max 200 |
| Description | validators allow max 5000, EF config stores max 2000; use 2000 as safe persisted limit until code is reconciled |
| Status | backend statuses are `Todo`, `InProgress`, `Done`; parser accepts legacy aliases such as `pending` and `completed` |
| Priority | `VeryLow`, `Low`, `Medium`, `High`, `Urgent`; EF stores integer value |
| Expected/due dates | expected date cannot be after due date when both are present |
| Category | Todo validates category ownership through Category service |
| Sharing | direct `sharedWithUserIds` must be accepted friends; the task form exposes public all-friends visibility inside `Share With`; `IsPublic` is independent from direct shares and makes the task visible to all accepted friends |
| Non-owner updates | friend-visible viewer can only change status |

### Frontend Behavior

- Active todo page loads active tasks in pages of 200.
- Completed preview uses page size 20.
- Sorting groups active tasks by date urgency and priority in `frontend/src/utils/sort-tasks.ts`.
- Category filter state is stored in local storage by `frontend/src/utils/category-filter.ts`.
- Keyboard shortcuts confirmed in `frontend/src/app/todos/page.tsx`: `F` opens category filter and `C` opens create panel when focus is not inside form controls.
- Dashboard also keeps the `C` create-panel shortcut. The collapsed panel header shows "New task" as its title and a `press C to open` `<kbd>` hint in the subtitle so the shortcut is self-documenting without a separate dismissible banner.
- Pressing `Escape` inside the create task panel returns it to the collapsed create action with a calm layout fade instead of leaving an empty white panel or adding bounce.
- `frontend/src/components/todos/todo-card.tsx` runs a short local completion/reopen animation before calling the page-level status update, so list refreshes happen after the card has visually acknowledged the action.
- Hidden/collapsed task cards blur the category pill until hover/focus, keeping category filtering visible without exposing it at rest.
- Urgent, overdue, and due-today private cards use a red border only; shared/public urgent cards keep the blue shared frame and use a red left border wall. The previous filled left urgency stripe is intentionally absent.
- The create task panel keeps title and description as labeled light panels, followed by full-width priority, category, due date, and `Share With` sections. Character-limited fields show `current/max` counters at the panel edge and switch to red warning state from 80% of the limit. Friend visibility stays inside a neutral `Share With` selector where all-friends visibility and direct friend selection are mutually exclusive, and the panel does not expose a tags field or a duplicate property summary.
- On the dashboard, the create panel opens with a softened layout transition and staged field reveal. Its primary plus icon becomes a rotated close action while the panel is open, so the same control pattern can open and close the draft surface.
- Toast notifications render on the toast z-index layer and start below the fixed navbar, so completion/update feedback is not hidden behind the header.
- The floating navbar quick-creates tasks (title only, private, no category) and dispatches a `planora:task-created` custom DOM event on success. Both the dashboard and todos pages listen for this event to refresh their task lists without a page reload; the dashboard also resets pagination to page 1.
- When the user removes a category during task edit, `applyCategoryPatch` (`frontend/src/utils/todo-utils.ts`) zeroes all four category fields (`categoryId`, `categoryName`, `categoryColor`, `categoryIcon`) in local state after the PUT — necessary because the backend treats `categoryId: null` as a no-op and echoes back the old values.
- Todo, dashboard, and completed-task pages enrich author names for public friend tasks as well as direct shared tasks.

## Task Workers ("В работе")

### Purpose

Allow friends to claim participation slots on public or shared tasks. The task owner sets an optional `RequiredWorkers` capacity. Workers join voluntarily and can leave at any time.

### Implementation

- `Services/TodoApi/Planora.Todo.Domain/Entities/TodoItem.cs` — `AddWorker`, `RemoveWorker`, `SetRequiredWorkers`, `CleanupWorkersOnAccessChange`
- `Services/TodoApi/Planora.Todo.Domain/Entities/TodoItemWorker.cs`
- `Services/TodoApi/Planora.Todo.Domain/Events/TodoWorkerJoinedDomainEvent.cs`
- `Services/TodoApi/Planora.Todo.Domain/Events/TodoWorkerLeftDomainEvent.cs`
- `Services/TodoApi/Planora.Todo.Domain/Events/TodoWorkerRemovedDomainEvent.cs`
- `Services/TodoApi/Planora.Todo.Application/Features/Todos/Commands/JoinTodo/`
- `Services/TodoApi/Planora.Todo.Application/Features/Todos/Commands/LeaveTodo/`
- `frontend/src/components/todos/worker-join-button.tsx`

### Key Rules

| Rule | Detail |
|---|---|
| Owner is never stored as a worker | Owner implicitly participates on their own task; calling `/join` as owner returns success with `isWorking: true` (idempotent, no DB write) |
| `RequiredWorkers` semantics | Total headcount including owner; `null` means unlimited; `1` means owner-only (always full) |
| Capacity check | `IsCapacityFull` when `RequiredWorkers.HasValue && Workers.Count >= RequiredWorkers - 1` |
| Join guards | Must have task access (public or shared); for non-public tasks, must be friends with owner; must not be at capacity; already-a-worker returns idempotent success |
| Leave guard | Owner cannot leave; leaving a task where user is not a worker throws `EntityNotFoundException` |
| Eviction on access change | Removing a user from `SharedWith`, making a task private, or reducing `RequiredWorkers` below current worker count triggers automatic eviction (LIFO for capacity reduction) |
| EF Core persistence | Join/Leave handlers use `GetByIdWithIncludesTrackedAsync` (tracked query, no `AsNoTracking`). Change tracking correctly marks new workers as `Added` → `INSERT` and removed workers as orphaned `Deleted` → `DELETE` via `OnDelete(Cascade)`. No explicit `DbSet.Update()` call needed or made. |
| Worker fields in DTO | `workerCount`, `workerUserIds`, `requiredWorkers`, `isWorking` patched on every GET/mutation response |

### Frontend Behavior

- Worker count badge (`X/Y`) shows the current active workers (including owner's InProgress slot) over the total `requiredWorkers` capacity.
- `WorkerJoinButton` renders nothing for the owner; shows "Join" (indigo) for eligible friends; shows disabled "Full" with a lock icon when at capacity; shows "Leave" (outlined) when already working.
- `onJoin` / `onLeave` callbacks on `TodoCard` optimistically update `isWorking` and `workerCount` in local state.

## Task Comments

### Purpose

Provide a persistent discussion thread on public and shared tasks. Only the owner and active workers can post; anyone with task access can read.

### Implementation

- `Services/TodoApi/Planora.Todo.Domain/Entities/TodoItemComment.cs`
- `Services/TodoApi/Planora.Todo.Domain/Events/TodoCommentAddedDomainEvent.cs`
- `Services/TodoApi/Planora.Todo.Domain/Repositories/ITodoCommentRepository.cs`
- `Services/TodoApi/Planora.Todo.Infrastructure/Persistence/Repositories/TodoCommentRepository.cs`
- `Services/TodoApi/Planora.Todo.Application/Features/Todos/Commands/AddComment/`
- `Services/TodoApi/Planora.Todo.Application/Features/Todos/Commands/UpdateComment/`
- `Services/TodoApi/Planora.Todo.Application/Features/Todos/Commands/DeleteComment/`
- `Services/TodoApi/Planora.Todo.Application/Features/Todos/Queries/GetComments/`
- `frontend/src/components/todos/task-comments.tsx`

### Key Rules

| Rule | Detail |
|---|---|
| Read access | owner, any user with task access (public/shared) who is also friends with the owner |
| Write access | owner or active worker (in `todo_item_workers`) |
| Content limits | max 2000 characters; cannot be empty |
| `AuthorName` | denormalized at write time from JWT `name` or `given_name` claim, falling back to email then userId |
| Edit rules | only the comment author can edit their own comment |
| Delete rules | comment author OR task owner can delete; results in soft delete |
| `IsEdited` | true when `UpdatedAt > CreatedAt + 5 seconds` |
| `UpdatedAt` on create | not set on creation; only set when content is actually updated via `UpdateContent` |
| Cascade delete | todo soft-delete also soft-deletes all comments via `SoftDeleteByTodoIdAsync` |
| Pagination | `GET {id}/comments` accepts `pageNumber` (default 1) and `pageSize` (default 50); sorted oldest-first |

### Frontend Behavior

- `TaskComments` renders inside the edit modal for tasks with a shared audience.
- Comments are fetched oldest-first (chat style) on mount; "Load earlier" button appends the next page.
- `isOwn` controls edit/delete button visibility; `isEdited` renders "(edited)" label.
- Ctrl+Enter submits the draft; a 2000-character counter warns at the input edge.
- Soft-deleted comments are removed from local state immediately without a full refetch.

## Shared Todos And Hidden Viewer Preferences

### Purpose

Allow a viewer to hide a shared/public task without changing the owner's task. Hidden shared/public tasks must not leak owner content.

### Implementation

- `Services/TodoApi/Planora.Todo.Application/Features/Todos/TodoViewerStateResolver.cs`
- `Services/TodoApi/Planora.Todo.Application/Features/Todos/HiddenTodoDtoFactory.cs`
- `Services/TodoApi/Planora.Todo.Application/Features/Todos/Commands/SetTodoHidden`
- `Services/TodoApi/Planora.Todo.Application/Features/Todos/Commands/SetViewerPreference`
- `Services/TodoApi/Planora.Todo.Domain/Entities/UserTodoViewPreference.cs`
- `frontend/src/app/todos/page.tsx`
- `frontend/e2e/auth-todos-sharing-hidden.api.spec.ts`
- `docs/DECISIONS/0004-viewer-specific-todo-visibility.md`

### Key Rules

| Viewer | Hidden behavior |
|---|---|
| Owner/private task | uses `TodoItem.Hidden`; private owner task remains readable even when hidden |
| Owner/shared task | uses viewer preference or legacy global hidden state |
| Non-owner public or directly shared friend task | uses viewer preference only |

Redacted shared/public DTOs contain:

- same todo id;
- `UserId = Guid.Empty` for non-owners;
- `Title = "Hidden task"`;
- `Hidden = true`;
- empty/default status, completed flag, tags, shared user ids, created date, and date/completion metadata;
- preserved non-content visual state: `Priority`, `IsPublic`, `HasSharedAudience`, and `IsVisuallyUrgent`, so collapsed cards keep urgent/shared frames after a page refresh without exposing the hidden task body;
- viewer category id/name/color/icon if available.

The frontend performs optimistic collapse/redaction when hiding a shared task, but server-side redaction is the source of truth. Reveal is not optimistically expanded: `frontend/src/app/todos/page.tsx`, `frontend/src/app/dashboard/page.tsx`, and `frontend/src/app/todos/completed/page.tsx` keep the hidden card collapsed until `fetchTaskById` returns full task details.

Automated verification: `frontend/e2e/auth-todos-sharing-hidden.api.spec.ts` covers registration, email verification, accepted friendship, shared todo creation, hidden redaction, owner visibility, and reveal behavior through the API Gateway and Docker services.

## Messaging

### Purpose

Send and fetch direct messages.

### Implementation

- `Services/MessagingApi/Planora.Messaging.Api/Controllers/MessagesController.cs`
- `Services/MessagingApi/Planora.Messaging.Application/Features/Messages`
- `Services/MessagingApi/Planora.Messaging.Domain/Entities/Message.cs`

### Key Rules

| Field | Rule |
|---|---|
| `recipientId` | required |
| `subject` | required, max 200 |
| `body` | required, max 10000 |
| `pageSize` | max 100 |

The HTTP controller overwrites sender from the current user context by sending `SenderId = null` into the command.

## Realtime Notifications

### Purpose

Track current connections and deliver notifications through SignalR and service notification abstractions.

### Implementation

- `Services/RealtimeApi/Planora.Realtime.Api/Controllers/ConnectionsController.cs`
- `Services/RealtimeApi/Planora.Realtime.Api/Controllers/NotificationsController.cs`
- `Services/RealtimeApi/Planora.Realtime.Api/Program.cs`
- `Services/RealtimeApi/Planora.Realtime.Infrastructure/Hubs/NotificationHub.cs`

### Key Rules

- `/api/v1/connections/active` returns only the current user's connections.
- `/api/v1/connections/stats` is admin-only.
- `/api/v1/notifications/send` sends to the authenticated user from the JWT `sub` claim.
- `/api/v1/notifications/broadcast` is admin-only.
- SignalR reads `access_token` from the query string for `/hubs` paths.
- Redis backplane channel prefix is `planora`.

## Product Analytics Events

### Purpose

Accept a small allowlist of frontend product events and log them through structured business logging.

### Implementation

- `Services/AuthApi/Planora.Auth.Api/Controllers/AnalyticsController.cs`
- `BuildingBlocks/Planora.BuildingBlocks.Application/Services/IBusinessEventLogger.cs`
- `frontend/src/lib/analytics.ts`

### Key Rules

- Endpoint: `POST /auth/api/v1/analytics/events`
- Requires bearer auth and CSRF.
- `eventName` must be allowlisted.
- `properties` must be a JSON object and max 4096 bytes.
- Returns `202 Accepted` on success.
- Frontend dispatch requires an access token; unauthenticated restore/login screens do not post analytics.
- Frontend analytics failures are swallowed.

Allowlisted product event names:

- `SIGNUP_COMPLETED`
- `FIRST_TASK_CREATED`
- `FIRST_CATEGORY_CREATED`
- `FRIEND_REQUEST_SENT`
- `FRIEND_REQUEST_ACCEPTED`
- `TODO_SHARED`
- `HIDDEN_TODO_REVEALED`
- `SESSION_RESTORED`
- `TOKEN_REFRESH_FAILED`
