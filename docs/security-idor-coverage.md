# IDOR coverage map

This document enumerates every `[Authorize]` endpoint that takes a
resource-identifier path parameter and pairs it with the test (or
mechanism) that verifies it cannot be exercised against another user's
resource. Hand-curated; one row per endpoint. Auto-generation from the
OpenAPI surface is the planned successor.

Conventions:

- **Mechanism** — `Owner check (handler)` means the handler reads
  `_currentUserService.UserId` and either filters the query by that
  user-id or rejects with `Forbidden`. `Owner check (filter)` means the
  EF global query filter excludes other users' rows so the handler's
  `GetByIdAsync` returns null and surfaces as `NotFound` (still safe —
  the attacker cannot tell the difference between "doesn't exist" and
  "isn't yours"). `gRPC peer check` means the cross-service caller must
  present the right service key.
- **Status** — `pinned` means an explicit cross-user xUnit test exists
  and is named in the third column; `covered by suite` means the handler
  carries `_currentUserService` reads + filter-based protection but the
  specific cross-user scenario is implicit in the handler's broader test
  class (every test sets `currentUser` to one identity and the handler
  resolves rows scoped to that identity); `gap` is an explicit hole that
  should be filled before the related code is touched again.

The xUnit test class names in the right column are the **actual files
that ship in `tests/Planora.UnitTests/`** — verified at commit time.

## Auth API

| Method + path | Resource | Mechanism | Status |
|---|---|---|---|
| `PUT /auth/api/v1/users/me` | User | Self-only — handler derives the target from `_currentUserService`; no path parameter. | covered by `Services/AuthApi/Users/Handlers/UserCommandHandlerTests.cs` |
| `DELETE /auth/api/v1/users/me` | User | Self-only — no path parameter. | covered by `Services/AuthApi/Users/Handlers/UserCommandHandlerTests.cs` |
| `POST /auth/api/v1/users/me/avatar` | User | Self-only — no path parameter. | covered by `Services/AuthApi/Users/Handlers/UploadAvatarCommandHandlerTests.cs` |
| `GET /auth/api/v1/users/me/sessions` | RefreshToken | Self-only — handler queries `_currentUserService`; no path parameter. | covered by `Services/AuthApi/Users/Handlers/UserSecurityHandlerTests.cs` (GetUserSecurity tests) |
| `DELETE /auth/api/v1/users/me/sessions/{tokenId}` | RefreshToken | `RevokeSessionCommandHandler` rejects with `Forbidden` if `token.UserId != currentUser`. | pinned by `Services/AuthApi/Users/Handlers/UserSecurityHandlerTests.cs::RevokeSession_WhenTokenBelongsToAnotherUser_ReturnsForbidden` |
| `GET /auth/api/v1/users/{userId:guid}` | User | Admin-only via `[Authorize(Roles = "Admin")]`. Role gate, not IDOR. | covered by `Services/AuthApi/Controllers/UsersControllerTests.cs` |
| `GET /auth/api/v1/users` | User (list) | Admin-only via `[Authorize(Roles = "Admin")]`. Role gate, not IDOR. | covered by `Services/AuthApi/Users/Handlers/GetUsersQueryHandlerTests.cs` |
| `GET /auth/api/v1/users/statistics` | Aggregate | Admin-only via `[Authorize(Roles = "Admin")]`. Role gate, not IDOR. | covered by `Services/AuthApi/Users/Handlers/UserQueryHandlerTests.cs` |
| `POST /auth/api/v1/friendships/requests` | Friendship | Self-as-requester. Body-supplied `friendId` is the *target* — not an IDOR vector because creating outbound requests is by design. | pinned by `Services/AuthApi/Friendships/FriendshipHandlerTests.cs::SendFriendRequest_ShouldRejectSelfMissingFriendAndExistingRelationship` |
| `POST /auth/api/v1/friendships/requests/{friendshipId}/accept` | Friendship | Acceptor must be the addressee. | pinned by `Services/AuthApi/Friendships/FriendshipHandlerTests.cs::AcceptRejectAndRemove_ShouldEnforceActorAndPersistStateTransitions` |
| `POST /auth/api/v1/friendships/requests/{friendshipId}/reject` | Friendship | Same — acceptor must be the addressee. | same as accept (one combined test asserts all three transitions enforce actor) |
| `DELETE /auth/api/v1/friendships/{friendId}` | Friendship | Either party can delete — `userId` matches one side of the row. | same as above (combined test) |
| `POST /auth/api/v1/analytics/events` | Analytics event | No path parameter — accepts the event body for the current user. | covered by `Services/AuthApi/Controllers/AnalyticsControllerTests.cs` |

## Todo API

| Method + path | Resource | Mechanism | Status |
|---|---|---|---|
| `GET /todos/api/v1/todos/{id}` | TodoItem | Owner OR shared-with-current-user OR public. `GetTodoByIdQueryHandler` applies the visibility predicate. | pinned by `Services/TodoApi/Handlers/TodoOwnershipHandlerTests.cs::GetTodoById_ShouldRejectSharedTodo_WhenFriendshipNoLongerExists` |
| `PUT /todos/api/v1/todos/{id}` | TodoItem | Owner-only mutation. | pinned by `Services/TodoApi/Handlers/TodoOwnershipHandlerTests.cs::UpdateTodo_*` |
| `DELETE /todos/api/v1/todos/{id}` | TodoItem | Owner-only. | covered by `Services/TodoApi/Handlers/TodoCommandHandlerExpandedTests.cs` |
| `PATCH /todos/api/v1/todos/{id}/hidden` | TodoItem | Viewer-only — every authenticated user may hide a *visible* todo for themselves; viewer-preference row keys on `(userId, todoId)`. Cross-user IDOR is irrelevant because hidden state is per-viewer. | covered by `Services/TodoApi/Handlers/TodoCommandHandlerExpandedTests.cs` (per-viewer scope) |
| `PATCH /todos/api/v1/todos/{id}/viewer-preferences` | UserTodoViewPreference | Same as hidden — viewer scope is the current user. Returning a completed task to active is **author-only**: a non-owner's `completedByViewer: false` (reopen) is rejected (`SetViewerPreferenceCommandHandler` → 403) once their stored preference is completed; they may complete (`: true`) but must **Duplicate** to fork a done task. | pinned by `Services/TodoApi/Handlers/TodoCommandHandlerExpandedTests.cs::SetViewerPreference_NonOwnerCannotReopenCompletedTask_ButMayStillComplete` |
| `POST /todos/api/v1/todos/{id}/join` | TodoItemWorker | Viewer joins an open public todo. IDOR not applicable (visibility predicate is the gate). | covered by `Services/TodoApi/Domain/TodoItemWorkerTests.cs` (capacity/eviction) + handler access checks |
| `POST /todos/api/v1/todos/{id}/leave` | TodoItemWorker | Viewer leaves; row keyed on `(userId, todoId)`. | covered by `Services/TodoApi/Domain/TodoItemWorkerTests.cs` |
| `GET /todos/api/v1/todos/{id}/subtasks` | TodoItem (children) | Caller must see the parent: owner OR shared-with-current-user OR public+friend. `GetSubtasksQueryHandler` mirrors the `GetTodoById` visibility predicate; per-viewer completion applied. | pinned by `Services/TodoApi/Handlers/TodoCommandHandlerExpandedTests.cs::GetSubtasks_RejectsViewerWithoutAccessToPrivateParent` (+ `GetSubtasks_ReturnsChildrenForOwner`) |
| `POST /todos/api/v1/todos/{id}/subtasks` | TodoItem (child) | Owner-only; the parent (from the route) must belong to the caller and not itself be a subtask. Inherits the parent's category/visibility/sharing. | pinned by `Services/TodoApi/Handlers/TodoCommandHandlerExpandedTests.cs::CreateSubtask_RejectsForeignParent` (+ `CreateSubtask_RejectsNestingUnderSubtask`) |
| `PUT /todos/api/v1/todos/{id}` (subtask) | TodoItem (child) | Editing a subtask's title/priority is **owner-only**; completing/reopening is allowed for anyone who can see the parent and applies **globally** (entity status, not a per-viewer row). | pinned by `Services/TodoApi/Handlers/TodoCommandHandlerExpandedTests.cs::UpdateTodo_NonOwnerCompletesSubtask_GloballyNotPerViewer` (+ `UpdateTodo_NonOwnerCannotEditSubtaskTitleOrPriority`) |
| `POST /todos/api/v1/todos/{id}/duplicate` | TodoItem (new copy) | **Any participant** — owner OR friend who can see a public/shared task — may fork it into a copy owned by the caller; access mirrors the view rule and is re-validated server-side (visibility **and** friendship). Subtasks cannot be duplicated. | pinned by `Services/TodoApi/Handlers/TodoCommandHandlerExpandedTests.cs::DuplicateTodo_ByParticipant_OnPublicFriendTask_CopiesUnderDuplicator` (+ `DuplicateTodo_ByNonFriendOnPublicTask_ThrowsForbidden`, `DuplicateTodo_ByNonOwner_ThrowsForbidden`) |

## Collaboration API

Base path `/collaboration/api/v1/comments`. The comment timeline moved out of Todo into the
Collaboration service. Every route delegates the access decision to Todo via the
`TodoService.CheckTaskCommentAccess` gRPC call (owner / shared / public + friendship, INV-AZ-4),
so the friend gate is enforced server-side in one place and never duplicated.

| Endpoint | Entity | Access rule | Coverage |
|---|---|---|---|
| `GET /collaboration/api/v1/comments/{taskId}` | Comment | Friend-of-owner OR owner (Todo `CheckTaskCommentAccess`). Missing task → 404; no access → 403. | `Services/CollaborationApi/Handlers/CommentCommandHandlerTests.cs`, `Services/CollaborationApi/IntegrationEvents/IntegrationEventConsumerTests.cs` |
| `POST /collaboration/api/v1/comments/{taskId}` | Comment | Same access check as GET; denied access → 403. | `CommentCommandHandlerTests.cs` (grant/deny/not-found) |
| `POST /collaboration/api/v1/comments/{taskId}/genesis` | Comment | Owner-only (`ownerId == requester`); one genesis per task. | `CommentCommandHandlerTests.cs` (non-owner → 403, duplicate guard) |
| `PUT /collaboration/api/v1/comments/{taskId}/{commentId}` | Comment | Comment author; task owner for genesis. Wrong task scope → 404. | `CommentCommandHandlerTests.cs` |
| `DELETE /collaboration/api/v1/comments/{taskId}/{commentId}` | Comment | Comment author OR task owner; non-genesis system comments are undeletable. | `CommentCommandHandlerTests.cs` (author/stranger/system) |

## Category API

| Method + path | Resource | Mechanism | Status |
|---|---|---|---|
| `PUT /categories/api/v1/categories/{id}` | Category | Owner-only — query filtered by `userId`. | pinned by `Services/CategoryApi/Handlers/UpdateCategoryCommandHandlerTests.cs` |
| `DELETE /categories/api/v1/categories/{id}` | Category | Owner-only — same filter. | covered by `Services/CategoryApi/Handlers/CreateDeleteCategoryCommandHandlerTests.cs` |

## Messaging API

| Method + path | Resource | Mechanism | Status |
|---|---|---|---|
| `GET /messaging/api/v1/messages` | Message | Sender OR recipient — pagination query filters both sides by current user. | covered by `Services/MessagingApi/Messages/GetMessagesQueryHandlerTests.cs` |
| `POST /messaging/api/v1/messages` | Message | New row — sender derived from `_currentUserService`, not request body. | covered by `Services/MessagingApi/Handlers/SendMessageHandlerTests.cs` |

## Realtime API

| Method + path | Resource | Mechanism | Status |
|---|---|---|---|
| `POST /realtime/api/v1/notifications/send` | Notification | Self-only — controller derives target user from the JWT `sub` claim (`User.FindFirst("sub")?.Value`); the body type is server-whitelisted to prevent type injection. | covered by `Services/RealtimeApi/Controllers/NotificationsControllerTests.cs` |
| `POST /realtime/api/v1/notifications/broadcast` | Notification | Admin-only via `[Authorize(Roles = "Admin")]`. | covered by `Services/RealtimeApi/Controllers/NotificationsControllerTests.cs` |
| `GET /realtime/api/v1/connections/active` | Connection (list) | Self-only — returns only the authenticated user's own connection ids. | covered by `Services/RealtimeApi/Controllers/ConnectionsControllerTests.cs` |
| `GET /realtime/api/v1/connections/stats` | Aggregate | Admin-only via `[Authorize(Roles = "Admin")]`. | covered by `Services/RealtimeApi/Controllers/ConnectionsControllerTests.cs` |

## Cross-service gRPC

| Procedure | Mechanism | Status |
|---|---|---|
| `Auth.FriendshipService/AreFriends` | gRPC service-key on every request (INV-COMM-2). Caller passes the *requesting user's* id in the payload — caller is trusted by the key, not by the payload. | pinned by `tests/Planora.UnitTests/BuildingBlocks/Grpc/ServiceKeyInterceptorTests.cs` |
| `Auth.UserService/GetUserAvatarsByIds` | Same — service-key. | pinned by `tests/Planora.UnitTests/BuildingBlocks/Grpc/ServiceKeyInterceptorTests.cs` |
| `Category.CategoryService/GetCategoryById` | Same — service-key. | pinned by `tests/Planora.UnitTests/BuildingBlocks/Grpc/ServiceKeyInterceptorTests.cs` |

## Known gaps

None at the time of writing. Every row above is either explicitly pinned
by a named test or covered by a broader handler test class. If a future
review finds a new gap, add a row to this section with the endpoint, the
missing assertion, and an effort estimate; remove the row when the test
ships.

## Maintenance contract

Any PR adding a new authorized endpoint with a path parameter must
update this table and ship an explicit cross-user handler test. Reviewers
reject PRs that omit either side. See `INV-AZ-8` in
[`INVARIANTS.md`](INVARIANTS.md).
