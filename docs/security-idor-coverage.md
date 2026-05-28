# IDOR coverage map

This document enumerates every `[Authorize]` endpoint that takes a
resource-identifier path parameter and pairs it with the test (or
mechanism) that verifies it cannot be exercised against another user's
resource. Maintained alongside master-plan **T3.6** (Phase 3) — the
forward step is auto-generation; this hand-curated table is the
interim baseline.

Conventions:

- **Mechanism** — `Owner check (handler)` means the handler reads
  `_currentUserService.UserId` and either filters the query by that
  user-id or rejects with `Forbidden`. `Owner check (filter)` means the
  EF global query filter excludes other users' rows so the handler's
  `GetByIdAsync` returns null and surfaces as `NotFound` (still safe —
  the attacker cannot tell the difference between "doesn't exist" and
  "isn't yours"). `gRPC peer check` means the cross-service caller must
  present the right service key.
- **Status** — `pinned` means a unit/integration test exists; `relies
  on filter` means coverage is implicit through the EF global filter and
  the handler patterns; `gap` is an explicit hole that should be filled
  before the related code is touched again.

## Auth API

| Method + path | Resource | Mechanism | Status |
|---|---|---|---|
| `PATCH /auth/api/v1/users/{userId}` | User | Self-only — handler derives the target from `_currentUserService`, route param exists only for symmetry. | pinned by `UpdateUserCommandHandler` tests |
| `DELETE /auth/api/v1/users/{userId}` | User | Self-only — same shape. | pinned by `DeleteUserCommandHandler` tests |
| `POST /auth/api/v1/users/{userId}/avatar` | User | Self-only — handler ignores the route param if it disagrees with the current-user claim. | relies on filter |
| `GET /auth/api/v1/users/sessions` | RefreshToken | Self-only — query filters by current user. | relies on filter |
| `DELETE /auth/api/v1/users/sessions/{tokenId}` | RefreshToken | `RevokeSessionCommandHandler` rejects with `Forbidden` if `token.UserId != currentUser`. | pinned (see handler) |
| `POST /auth/api/v1/friendships/requests` | Friendship | Self-as-requester. Body-supplied `friendId` is the *target* — not an IDOR vector because creating outbound requests is by design. | relies on uniqueness constraint |
| `POST /auth/api/v1/friendships/requests/{friendshipId}/accept` | Friendship | Acceptor must be the addressee. | pinned by `FriendshipAcceptHandlerTests` |
| `POST /auth/api/v1/friendships/requests/{friendshipId}/reject` | Friendship | Same — acceptor must be the addressee. | pinned by `FriendshipRejectHandlerTests` |
| `DELETE /auth/api/v1/friendships/{friendId}` | Friendship | Either party can delete — `userId` matches one side of the row. | pinned by `RemoveFriendHandlerTests` |

## Todo API

| Method + path | Resource | Mechanism | Status |
|---|---|---|---|
| `GET /todos/api/v1/todos/{id}` | TodoItem | Owner OR shared-with-current-user OR public. `GetTodoByIdQueryHandler` applies the visibility predicate. | pinned by `GetTodoByIdHandlerTests` |
| `PUT /todos/api/v1/todos/{id}` | TodoItem | Owner-only mutation. | pinned by `UpdateTodoHandlerTests` (IDOR scenario covered) |
| `DELETE /todos/api/v1/todos/{id}` | TodoItem | Owner-only. | pinned by `DeleteTodoHandlerTests` |
| `PATCH /todos/api/v1/todos/{id}/hidden` | TodoItem | Viewer-only — every authenticated user may hide a *visible* todo for themselves; viewer-preference row keys on `(userId, todoId)`. Cross-user IDOR is irrelevant because hidden state is per-viewer. | pinned by `HideTodoHandlerTests` |
| `PATCH /todos/api/v1/todos/{id}/viewer-preferences` | UserTodoViewPreference | Same as hidden — viewer scope is the current user. | pinned by `ViewerPreferenceHandlerTests` |
| `POST /todos/api/v1/todos/{id}/join` | TodoItemWorker | Viewer joins an open public todo. IDOR not applicable. | relies on visibility predicate |
| `POST /todos/api/v1/todos/{id}/leave` | TodoItemWorker | Viewer leaves; row keyed on `(userId, todoId)`. | relies on visibility predicate |
| `GET /todos/api/v1/todos/{id}/comments` | TodoItemComment | Friend-of-owner OR owner (INV-AZ-4). Non-friend non-owner gets 404. | pinned by `GetCommentsHandlerTests` |
| `POST /todos/api/v1/todos/{id}/comments` | TodoItemComment | Same as GET — friend gate enforced server-side. | pinned by `AddCommentHandlerTests` |
| `POST /todos/api/v1/todos/{id}/genesis` | TodoItemComment | Owner-only — only the original owner can mark a genesis comment. | pinned by `GenesisCommentHandlerTests` |
| `PUT /todos/api/v1/todos/{id}/comments/{commentId}` | TodoItemComment | Comment author OR todo owner. | pinned by `EditCommentHandlerTests` |
| `DELETE /todos/api/v1/todos/{id}/comments/{commentId}` | TodoItemComment | Comment author OR todo owner. | pinned by `DeleteCommentHandlerTests` |

## Category API

| Method + path | Resource | Mechanism | Status |
|---|---|---|---|
| `PUT /categories/api/v1/categories/{id}` | Category | Owner-only — query filtered by `userId`. | pinned by `UpdateCategoryHandlerTests` |
| `DELETE /categories/api/v1/categories/{id}` | Category | Owner-only — same filter. | pinned by `DeleteCategoryHandlerTests` |

## Messaging API

| Method + path | Resource | Mechanism | Status |
|---|---|---|---|
| `GET /messaging/api/v1/messages` | Message | Sender OR recipient — pagination query filters both sides by current user. | relies on filter |
| `POST /messaging/api/v1/messages` | Message | New row — sender derived from `_currentUserService`, not request body. | pinned (handler reads current user) |

## Realtime API

| Method + path | Resource | Mechanism | Status |
|---|---|---|---|
| `POST /realtime/api/v1/notifications/broadcast` | Notification | Admin-only via `[Authorize(Roles = "Admin")]`. | pinned by `BroadcastNotificationControllerTests` |
| `GET /realtime/api/v1/connections/stats` | (none, aggregate) | Admin-only via `[Authorize(Roles = "Admin")]`. | pinned by `ConnectionsControllerTests` |

## Cross-service gRPC

| Procedure | Mechanism | Status |
|---|---|---|
| `Auth.FriendshipService/AreFriends` | gRPC service-key on every request (INV-COMM-2). Caller passes the *requesting user's* id in the payload — caller is trusted by the key, not by the payload. | pinned by `ServiceKeyInterceptorTests` |
| `Auth.UserService/GetUserAvatarsByIds` | Same — service-key. | pinned by `ServiceKeyInterceptorTests` |
| `Category.CategoryService/GetCategoryById` | Same — service-key. | pinned by `ServiceKeyInterceptorTests` |

## What's missing (audit gaps to fix when handlers are next touched)

None of the rows above are currently marked `gap` — every IDOR-relevant
endpoint either has an explicit handler test or relies on a documented
filter/visibility predicate. The forward step is **T3.6 auto-generation**:
a code-gen step in `tools/` that reads the controller surface and emits an
xUnit theory test per IDOR row in this table, so future drift (a handler
losing its ownership check) fails CI before merge. That work is out of
scope for this commit because it depends on the OpenAPI document being the
single source of truth for the endpoint surface, which lands with
**T2.1 / T2.2-fu**.

Until then: any PR that adds a new authorized endpoint with a path
parameter must add a row to this table and an explicit handler test, and
the reviewer must reject the PR if either is missing.
