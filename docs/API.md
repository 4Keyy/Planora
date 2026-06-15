# HTTP API Reference

Base URL for the browser/frontend is the API Gateway:

```text
http://localhost:5132
```

Route evidence:

- `Planora.ApiGateway/ocelot.json`
- `Planora.ApiGateway/ocelot.Docker.json`
- service controllers under `Services/*/Planora.*.Api/Controllers`

## Conventions

### Auth

Protected routes require:

```http
Authorization: Bearer <access-token>
```

Auth state-changing browser routes also require CSRF:

```http
X-CSRF-Token: <value from XSRF-TOKEN cookie>
```

The frontend sends CSRF headers for all state-changing API calls, but backend CSRF validation is implemented in the Auth API pipeline.

### Response Shapes

The codebase uses a few response shapes:

| Shape | Example | Code |
|---|---|---|
| raw DTO/object | login/register/user endpoints | individual controllers |
| `Result<T>` wrapper | some category/friendship/todo paths | `ResultToActionResultFilter`, controller return code |
| `PagedResult<T>` | todos, users, friends, login history, messages | `BuildingBlocks/Planora.BuildingBlocks.Application/Pagination/PagedResult.cs` |
| error envelope | exception middleware failures | `BuildingBlocks/Planora.BuildingBlocks.Domain/ApiResponse.cs` |

`PagedResult<T>` fields:

```json
{
  "items": [],
  "pageNumber": 1,
  "pageSize": 10,
  "totalCount": 0,
  "totalPages": 0,
  "hasPreviousPage": false,
  "hasNextPage": false
}
```

Frontend unwrapping code:

- `frontend/src/lib/api.ts:parseApiResponse`
- `frontend/src/types/category.ts:toCategoryList`

### Rate Limits

Service-level rate limiting policies are configured in `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Extensions/ServiceCollectionExtensions.cs`.

| Policy | Limit | Applied |
|---|---:|---|
| `register` | 3 requests/minute/IP | `POST /auth/api/v1/auth/register` |
| `login` | 5 requests/minute/IP | `POST /auth/api/v1/auth/login` |
| `auth` | 10 requests/minute/IP | refresh/logout/validate-token/password reset |
| `data` | 50 requests/minute/IP | configured but no controller usage found in inspected routes |

Ocelot route files leave most routes unthrottled, but the realtime route enables `RateLimitOptions` with a 100 requests/minute window. Gateway `Program.cs` also registers an ASP.NET Core limiter, but no `app.UseRateLimiter()` call was found there.

## Gateway Route Map

| Gateway route | Downstream service | Auth |
|---|---|---|
| `GET /health` | gateway | public |
| `GET /auth/health` | Auth API | public |
| `GET /todos/health` | Todo API | public |
| `GET /categories/health` | Category API | public |
| `GET /messaging/health` | Messaging API | public |
| `GET /collaboration/health` | Collaboration API | public |
| `GET /realtime/health` | Realtime API | public |
| `/auth/api/v1/auth/{everything}` | Auth `AuthenticationController` | mixed |
| `/auth/api/v1/users/{everything}` | Auth `UsersController` | bearer at gateway; `VerifyEmailByToken` is `[AllowAnonymous]` in the service controller |
| `/auth/api/v1/friendships*` | Auth `FriendshipsController` | bearer |
| `/friendships*` | Auth `FriendshipsController` legacy route | bearer |
| `/auth/api/v1/analytics/{everything}` | Auth `AnalyticsController` | bearer |
| `/todos/api/v1/{everything}` | Todo API | bearer |
| `/categories/api/v1/{everything}` | Category API | bearer |
| `/messaging/api/v1/{everything}` | Messaging API | bearer |
| `/collaboration/api/v1/{everything}` | Collaboration API (task comment timeline) | bearer |
| `/realtime/{everything}` | Realtime API, websocket route | route-dependent |

## Authentication

Controller: `Services/AuthApi/Planora.Auth.Api/Controllers/AuthenticationController.cs`

### `GET /auth/api/v1/auth/csrf-token`

Public. Issues the double-submit CSRF token.

Response:

```json
{
  "token": "<base64-random-token>",
  "expiresIn": 3600
}
```

Side effect: sets readable `XSRF-TOKEN` cookie with `SameSite=Strict`, `Path=/`, one-hour expiry.

### `POST /auth/api/v1/auth/register`

Public, CSRF, rate limit `register`.

Body:

```json
{
  "email": "user@example.com",
  "password": "StrongPass123!",
  "confirmPassword": "StrongPass123!",
  "firstName": "Jane",
  "lastName": "Doe"
}
```

Validation:

- email required, valid, max 255;
- password required, 8-128, uppercase, lowercase, digit, special char;
- confirmation must match;
- first and last name required, max 100, letters/spaces/hyphen/apostrophe.

Success `200`: access token and user fields. Refresh token is set only as httpOnly cookie and omitted from JSON.

Errors:

- `400` validation or command failure;
- `409` duplicate/already-existing user.

### `POST /auth/api/v1/auth/login`

Public, CSRF, rate limit `login`.

Body:

```json
{
  "email": "user@example.com",
  "password": "StrongPass123!",
  "rememberMe": true,
  "twoFactorCode": "123456"
}
```

`twoFactorCode` is optional but must be 6 characters when present.

Success `200`: access token, user fields, expiry, `twoFactorEnabled`. Refresh token is set as httpOnly cookie. If `rememberMe` is false, the cookie is session-only.

Error: `401` for failed login.

### `POST /auth/api/v1/auth/refresh`

Public, CSRF, rate limit `auth`.

Reads `refresh_token` from the httpOnly cookie. No JSON body is required.

Success `200`:

```json
{
  "accessToken": "<jwt>",
  "expiresAt": "2026-05-03T12:00:00Z",
  "tokenType": "Bearer",
  "rememberMe": true
}
```

Side effect: rotates the refresh cookie.

Errors:

- `204 No Content` if the refresh cookie is absent;
- `400`, `401`, or `404` depending on refresh-token failure.

### `POST /auth/api/v1/auth/logout`

Bearer, CSRF, rate limit `auth`.

Body may be empty. Controller also accepts legacy body with refresh token, but current frontend relies on cookie.

Success `200`:

```json
{ "message": "Logged out successfully" }
```

Side effect: always deletes `refresh_token` cookie.

### `POST /auth/api/v1/auth/validate-token`

Public, CSRF, rate limit `auth`.

Token can be provided through `Authorization: Bearer <token>` or legacy body:

```json
{ "token": "<jwt>" }
```

Returns `TokenValidationDto` from `Services/AuthApi/Planora.Auth.Application/Features/Authentication/Response/TokenValidationDto.cs`.

### `POST /auth/api/v1/auth/request-password-reset`

Public, CSRF, rate limit `auth`.

Body:

```json
{ "email": "user@example.com" }
```

Success is intentionally generic:

```json
{ "message": "If the email exists, a password reset link has been sent." }
```

### `POST /auth/api/v1/auth/reset-password`

Public, CSRF, rate limit `auth`.

Body:

```json
{
  "resetToken": "<token>",
  "newPassword": "NewStrongPass123!",
  "confirmPassword": "NewStrongPass123!"
}
```

Success:

```json
{ "message": "Password has been reset successfully" }
```

## Users

Controller: `Services/AuthApi/Planora.Auth.Api/Controllers/UsersController.cs`

Canonical prefix: `/auth/api/v1/users`

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/me` | bearer | current user profile |
| `PUT` | `/me` | bearer + CSRF | update profile |
| `DELETE` | `/me` | bearer + CSRF | delete account |
| `POST` | `/me/change-password` | bearer + CSRF | change password |
| `POST` | `/me/change-email` | bearer + CSRF | request email change |
| `GET` | `/verify-email?token=...` | public | verify email by token |
| `POST` | `/me/verify-email` | bearer + CSRF | send/resend verification link; legacy body token also verifies |
| `GET` | `/me/security` | bearer | security summary |
| `POST` | `/me/2fa/enable` | bearer + CSRF | start TOTP setup |
| `POST` | `/me/2fa/confirm` | bearer + CSRF | confirm TOTP — returns 10 single-use recovery codes |
| `POST` | `/me/2fa/disable` | bearer + CSRF | disable TOTP |
| `GET` | `/me/sessions` | bearer | list sessions |
| `DELETE` | `/me/sessions/{tokenId}` | bearer + CSRF | revoke session |
| `POST` | `/me/sessions/revoke-all` | bearer + CSRF | revoke all sessions |
| `GET` | `/me/login-history?pageNumber=&pageSize=` | bearer | login history |
| `POST` | `/me/avatar` | bearer + CSRF + `multipart/form-data` | upload profile avatar |
| `GET` | `/statistics` | admin | user statistics |
| `GET` | `/` | admin | paged users |
| `GET` | `/{userId}` | admin | user detail |

### Avatar upload

`POST /auth/api/v1/users/me/avatar` accepts a single `file` field as `multipart/form-data`.

| Limit | Value | Enforced by |
|---|---|---|
| Max body size | 6 MB (5 MB payload + multipart overhead) | `[RequestSizeLimit]` on the action |
| Max image bytes | 5 MB | `UploadAvatarCommandValidator` + `ImageSharpImageProcessor` |
| Allowed MIME | `image/jpeg`, `image/png`, `image/webp` | content-type whitelist + magic-byte sniff |
| Min dimensions | 64×64 | ImageSharp decoder check |
| Max dimensions | 4096×4096 | ImageSharp decoder check |
| Output format | always `image/webp` (re-encoded server-side, lossy q=85) | `ImageSharpImageProcessor` |
| Metadata stripping | EXIF / ICC / XMP cleared before re-encode | `ImageSharpImageProcessor` |

Error codes:

| HTTP | Error code | Cause |
|---|---|---|
| `400` | `INVALID_IMAGE_CONTENT` | File is not a decodable image, or fails min-dimension check |
| `413` | `INVALID_FILE_SIZE` | Payload exceeds 5 MB |
| `415` | `UNSUPPORTED_MEDIA_TYPE` | MIME or magic bytes outside JPEG/PNG/WEBP whitelist |
| `401` | `NOT_AUTHENTICATED` | Missing/invalid bearer token |
| `404` | `USER_NOT_FOUND` | Authenticated user record was deleted |

Success returns `UserDto` with `profilePictureUrl` pointing at the canonical (medium, 128px) WebP variant. Three variants are persisted for every upload — the URL scheme is `/avatars/{userId:N}/{contentHash}/{size}.webp` where `size ∈ {64, 128, 512}`. Clients build other variant URLs by swapping the size segment.

The path is content-addressed: changing the avatar produces a new hash subdirectory, and the previous one is pruned. This makes `Cache-Control: public, max-age=31536000, immutable` safe for `/avatars/*` — the URL itself changes when the bytes change. Static-file serving is configured in `Services/AuthApi/Planora.Auth.Api/Program.cs` with `X-Content-Type-Options: nosniff` and `ServeUnknownFileTypes = false`.

`GET /me` and admin user detail responses include `isEmailVerified` and `emailVerifiedAt`. `isEmailVerified` is the direct boolean status; `emailVerifiedAt` is present when the verification timestamp is known.

Profile update body:

```json
{
  "firstName": "Jane",
  "lastName": "Doe",
  "profilePictureUrl": "https://example.com/avatar.png"
}
```

Delete/revoke-all/disable-2FA bodies require `password`. Confirm 2FA body requires `code`.

Confirm 2FA success response shape:

```json
{
  "message": "Two-factor authentication enabled successfully",
  "recoveryCodes": [
    "ABCDE-12345",
    "FGHIJ-67890"
  ]
}
```

The `recoveryCodes` array contains exactly 10 codes formatted `XXXXX-XXXXX`. Each code is single-use and can be entered in place of a TOTP code at login. Store them securely — they are only returned once. A new set replaces all previous codes on every re-confirmation.

## Friendships

Controller: `Services/AuthApi/Planora.Auth.Api/Controllers/FriendshipsController.cs`

Canonical prefix: `/auth/api/v1/friendships`

Legacy prefix also routed by the gateway: `/friendships`

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/requests` | send request by user id |
| `POST` | `/requests/by-email` | send request by email |
| `POST` | `/requests/{friendshipId}/accept` | accept incoming request |
| `POST` | `/requests/{friendshipId}/reject` | reject incoming request |
| `DELETE` | `/{friendId}` | remove friend |
| `GET` | `?pageNumber=1&pageSize=10` | list friends |
| `GET` | `/requests?incoming=true` | list incoming or outgoing requests |
| `GET` | `/friend-ids?userId=<guid>` | internal friend id helper |
| `GET` | `/are-friends?userId1=<guid>&userId2=<guid>` | internal friendship helper |

Send by id:

```json
{ "friendId": "00000000-0000-0000-0000-000000000000" }
```

Send by email:

```json
{ "email": "friend@example.com" }
```

The by-email response is generic by design.

## Analytics Events

Controller: `Services/AuthApi/Planora.Auth.Api/Controllers/AnalyticsController.cs`

### `POST /auth/api/v1/analytics/events`

Bearer + CSRF.

Body:

```json
{
  "eventName": "SESSION_RESTORED",
  "properties": {
    "source": "frontend"
  },
  "occurredAt": "2026-05-03T12:00:00Z"
}
```

Rules:

- `eventName` is required and must be allowlisted by `BusinessEvents.IsAllowedProductEvent`.
- `properties` must be a JSON object when present.
- serialized properties must be <= 4096 bytes.
- the frontend only dispatches analytics when it has an access token, because the endpoint is authenticated.

Success: `202 Accepted`.

Errors:

- `400 EVENT_NAME_REQUIRED`
- `400 UNKNOWN_ANALYTICS_EVENT`
- `400 INVALID_PROPERTIES`
- `400 PROPERTIES_TOO_LARGE`

## Categories

Controller: `Services/CategoryApi/Planora.Category.Api/Controllers/CategoriesController.cs`

Gateway prefix: `/categories/api/v1/categories`

All routes require bearer auth. State-changing frontend calls include CSRF header, although CSRF validation was only found in Auth API.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/` | list current user's categories |
| `POST` | `/` | create category |
| `PUT` | `/{id}` | update category |
| `DELETE` | `/{id}` | delete category |

Create body:

```json
{
  "userId": null,
  "name": "Work",
  "description": "Work tasks",
  "color": "#007BFF",
  "icon": "Briefcase",
  "displayOrder": 0
}
```

The controller overwrites `userId` with current user context by sending `UserId = null` to the handler.

Validation:

- `name` required, max 50;
- `description` max 500;
- `color` must be a predefined color or `#` plus six alphanumeric characters.

`DELETE` returns `204`, `404`, `403`, or `400` depending on handler result.

## Todos

Controller: `Services/TodoApi/Planora.Todo.Api/Controllers/TodosController.cs`

Gateway prefix: `/todos/api/v1/todos`

All routes require bearer auth.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `?pageNumber=1&pageSize=10&status=&categoryId=&isCompleted=` | list own and friend-visible todos |
| `GET` | `/public?pageNumber=1&pageSize=10&friendId=` | list public or directly shared friend todos |
| `GET` | `/{id}` | get one todo |
| `POST` | `/` | create todo |
| `PUT` | `/{id}` | update todo |
| `DELETE` | `/{id}` | delete todo |
| `PATCH` | `/{id}/hidden` | owner hidden toggle |
| `PATCH` | `/{id}/viewer-preferences` | non-owner viewer hidden/category/completion preference (reopen blocked — see below) |
| `POST` | `/{id}/join` | join task as a worker |
| `POST` | `/{id}/leave` | leave task (stop being a worker) |
| `POST` | `/{id}/duplicate` | duplicate a task into a fresh active copy (any participant) |
| `GET` | `/{id}/subtasks` | list a task's subtasks (anyone with parent access) |
| `POST` | `/{id}/subtasks` | create a subtask (owner only; category/visibility inherited) |

> **Comments (the task timeline / "ветки") moved to the Collaboration service** — see the
> [Collaboration](#collaboration) section. The old `/{id}/comments*` and `/{id}/genesis`
> routes under `/todos/api/v1/todos` no longer exist.

Subtask reads are enriched with the author's **live identity**: `GET /{id}/subtasks` resolves
`authorName` + `authorAvatarUrl` for each subtask from Auth (`GetUserProfilesBatch`, one batch call
per request, failure-tolerant — labels are simply empty if Auth is down), and
`POST /{id}/subtasks` fills them from the caller's own JWT claims (the creator is the caller).
Both fields are `null` on list endpoints that skip the enrichment (e.g. the dashboard task lists).

Create body:

```json
{
  "userId": null,
  "title": "Pay bills",
  "description": "Electricity and internet",
  "categoryId": "00000000-0000-0000-0000-000000000000",
  "dueDate": "2026-05-10T12:00:00Z",
  "expectedDate": "2026-05-09T12:00:00Z",
  "priority": "Medium",
  "isPublic": false,
  "sharedWithUserIds": [],
  "requiredWorkers": 3
}
```

Update body fields are optional:

```json
{
  "title": "Updated title",
  "description": "Updated description",
  "categoryId": null,
  "dueDate": null,
  "expectedDate": null,
  "actualDate": null,
  "priority": "High",
  "isPublic": true,
  "sharedWithUserIds": ["00000000-0000-0000-0000-000000000000"],
  "status": "InProgress",
  "requiredWorkers": 3,
  "clearRequiredWorkers": false
}
```

Rules:

- title required on create, max 200 for a regular task; **subtask titles allow up to 1500** (a subtask's whole content lives in its title — see `POST /todos/{id}/subtasks`). The shared update endpoint (`PUT /todos/{id}`) also accepts up to 1500 because subtask renames go through it;
- description optional, max 2000 (validators and the EF column agree);
- expected date cannot be after due date;
- category must belong to current user;
- shared users must be accepted friends;
- `isPublic` is independent from `sharedWithUserIds`; public tasks are visible to all accepted friends, direct shares are visible to the selected accepted friends;
- non-owner friend-visible viewer can only change `status`;
- backend statuses are `Todo`, `InProgress`, `Done`; parser also accepts aliases;
- `requiredWorkers` must be ≥ 1 when set; for non-public tasks it cannot exceed `1 + sharedWith.Count`;
- set `clearRequiredWorkers: true` to remove the capacity limit on update.

`TodoItemDto` worker fields:

```json
{
  "requiredWorkers": 3,
  "workerCount": 1,
  "isWorking": true,
  "workerUserIds": ["00000000-0000-0000-0000-000000000000"]
}
```

Hidden toggle body:

```json
{ "hidden": true }
```

Viewer preference body (non-owner only; the owner gets `OWNER_MUST_USE_HIDDEN_ENDPOINT`):

```json
{
  "hiddenByViewer": true,
  "viewerCategoryId": "00000000-0000-0000-0000-000000000000",
  "updateViewerCategory": true,
  "completedByViewer": true
}
```

- `completedByViewer: true` marks the shared/public task done **for this viewer only** (writes
  `UserTodoViewPreference.CompletedByViewer`; never touches the owner's `TodoItem`).
- `completedByViewer: false` (reopen) is **rejected for non-owners** — returning a completed task
  to work is author-only. If the viewer's stored preference is already completed, the request fails
  with `403 ForbiddenException` ("Only the task author can return a completed task to active.
  Duplicate it to work on your own copy."). The non-owner's path on a done task is `POST /{id}/duplicate`.

### `POST /{id}/join`

Join the task as a worker. Requires friendship with the task owner and access to the task (public or shared). Owner cannot join their own task. Fails if already a worker or at capacity.

Success `200`: updated `TodoItemDto` with `isWorking: true`.

Errors: `400` for duplicate join, capacity full, or owner attempting to join; `403` for non-friend or no access; `404` if task not found.

### `POST /{id}/leave`

Leave a task. Fails if not currently a worker or if the user is the task owner.

Success `204 No Content`.

Errors: `400` for owner or non-worker; `404` if task not found.

### `POST /{id}/duplicate`

Duplicate a task into a brand-new **active** task owned by the caller. **Open to any participant** —
the owner, or a friend who can see the task (public or directly shared) — so a non-owner can fork a
completed task instead of reopening it (returning a task to work is author-only). The server authors
the copy and copies the task's content — title, description, priority, category (re-validated against
the duplicator; dropped if not theirs or since-deleted), visibility (`isPublic`), shared audience
(re-validated against the **duplicator's** current friendships — others dropped), tags, and
`requiredWorkers`. It deliberately does **not** copy the dates (`dueDate`/`expectedDate`), the
completion state (the copy starts active), or the **branch** (comments / subtasks). The copy emits the
same `TaskCreatedIntegrationEvent` a normal create does, so the new branch's "created" system comment
and all participant notifications fire.

No request body. Success `201 Created`: the new `TodoItemDto` (with category info populated). Errors:
`403` if the caller cannot access the task (not the owner and not a friend who can see a public/shared
task); `404` if the task does not exist or is a subtask (subtasks have no standalone existence to
duplicate); `503` if the Category/Auth gRPC checks are unavailable.

Hidden shared/public todos may return a redacted `TodoItemDto`; see [`features.md`](features.md#shared-todos-and-hidden-viewer-preferences).

## Collaboration

Gateway prefix: `/collaboration/api/v1/comments`. All routes require bearer auth.

The Collaboration service owns the task **comment timeline** ("ветки"). It does not own tasks:
every route authorises against the task via the `TodoService.CheckTaskCommentAccess` gRPC call,
which applies the same owner / shared / public + friendship rule the Todo handlers used to.

The pinned **"Author's Note"** (the task description) is **not** stored here. It is the single
source of truth on the task (`TodoItem.Description`, owned by Todo) and is synthesised into the
timeline on read from the same `CheckTaskCommentAccess` call (so it appears instantly, always
matches the task card, and is present for tasks created before this service existed). Edit the
description via the task itself (`PUT /todos/api/v1/todos/{id}`), not through a comment endpoint.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/{taskId}?pageNumber=1&pageSize=50` | get paginated comments (oldest-first); page 1 also includes the synthesised Author's Note |
| `POST` | `/{taskId}` | add a comment, optionally as a **reply** quoting another comment/reply or a subtask |
| `PUT` | `/{taskId}/{commentId}` | edit a regular comment (author only) |
| `DELETE` | `/{taskId}/{commentId}` | soft-delete a comment (author or task owner) |

### `GET /collaboration/api/v1/comments/{taskId}`

Get paginated comments for a task. Access requires task visibility (public/shared) and friendship
with the owner — enforced by the Todo gRPC access check. Default page size is 50, oldest-first.

Success `200`: `PagedResult<CommentDto>`.

`CommentDto` shape (wire-compatible with the former `TodoCommentDto` — the `todoItemId` field name
is kept so frontend timeline components are unchanged):

```json
{
  "id": "00000000-0000-0000-0000-000000000000",
  "todoItemId": "00000000-0000-0000-0000-000000000000",
  "authorId": "00000000-0000-0000-0000-000000000000",
  "authorName": "Alice",
  "authorAvatarUrl": null,
  "content": "Looks good!",
  "createdAt": "2026-05-10T14:00:00Z",
  "updatedAt": null,
  "isOwn": true,
  "isEdited": false,
  "isSystemComment": false,
  "isGenesisComment": false,
  "replyToType": null,
  "replyToId": null,
  "replyToAuthorId": null,
  "replyToAuthorName": null,
  "replyToAuthorAvatarUrl": null,
  "replyToPreview": null,
  "replyToDeleted": false
}
```

**Reply block** (`replyTo*` — all `null`/`false` on a plain comment): when the comment is a reply,
`replyToType` is `"comment"` (a user comment or another reply) or `"subtask"`, `replyToId` is the
quoted target's id and `replyToPreview` is a one-line excerpt (≤ 300 chars) of the quoted text.
The quoted author (`replyToAuthorId` / `replyToAuthorName` / `replyToAuthorAvatarUrl`) is resolved
**live** from Auth on every read — the stored name is only a fallback. For **comment** targets the
preview is refreshed from the live target on read (edits propagate) and `replyToDeleted` flips to
`true` the moment the target is gone (the stored snapshot then backs the preview). For **subtask**
targets the preview is the title snapshot taken at reply time and `replyToDeleted` is maintained by
the `SubtaskDeletedIntegrationEvent` consumer. Reply chains are just replies whose target is itself
a reply — there is no nesting limit and no extra endpoint.

`isOwn` is `true` when `authorId == currentUserId` AND `isSystemComment` is `false`. `isEdited` is
`true` when `updatedAt > createdAt + 5 seconds` for a regular user comment; system comments
(including the synthesised genesis) never report `isEdited`.

System comments (`isSystemComment: true`) are materialised automatically from Todo task-lifecycle
integration events (created / completed / started / left). They have `authorId = Guid.Empty`,
`authorName = ""`, `isOwn = false`. The **genesis** entry (`isGenesisComment: true`, only on page 1)
is the synthesised Author's Note: it is **not stored** — its `content` is the live task description,
its author is the task owner, and its `id` equals the task id. Author identity (name + avatar) for
both regular comments and the genesis is resolved **live** from Auth (`GetUserProfilesBatch`, 60 s
cache) — never a stored copy, so a profile rename is reflected everywhere.

Errors: `400` unauthenticated; `403` no access / non-friend; `404` task not found; `503` if the Todo
access check is unavailable.

### `POST /collaboration/api/v1/comments/{taskId}`

Add a comment. Caller must have task access. Body:

```json
{
  "content": "Great progress!",
  "replyTo": { "type": "comment", "id": "00000000-0000-0000-0000-000000000000" }
}
```

`content` — required, max 2000 characters. `replyTo` — optional; when present the comment becomes a
**reply** quoting the target. `type` is `"comment"` (a user comment or another reply in the same
branch) or `"subtask"` (a subtask of this task). The target is validated **server-side** and the
quote snapshot (author + preview) is captured there — preview text from the client is never
accepted. Comment targets must live in the same task branch and may not be system events or the
genesis note; subtask targets are verified live via the `TodoService.GetSubtaskBrief` gRPC call
(exists, not deleted, child of this exact task).

Success `201 Created`: `CommentDto` (with the populated reply block). On success a
`NotificationEvent` is fanned out (via outbox → RabbitMQ → Realtime/SignalR) to every other
participant; the quoted author receives a dedicated `ReplyAdded` notification ("… replied to your
message/subtask") instead of the generic `CommentAdded`. Errors: `400` validation / invalid reply
target type; `403` no access; `404` task, target comment, or target subtask not found (cross-branch
target ids return `404` exactly like missing ones — no probing oracle); `503` if the Todo
validation call is unavailable.

> **The task description (Author's Note) is edited on the task, not here.** Use
> `PUT /todos/api/v1/todos/{id}` with the new `description` (owner only). There is no genesis
> comment endpoint — the description is a single source of truth in Todo, synthesised into the
> timeline on read.

### `PUT /collaboration/api/v1/comments/{taskId}/{commentId}`

Edit a regular user comment. Only the author may edit it. Body: `{ "content": "Updated text" }` —
required, max 2000 characters. Success `200`: updated `CommentDto` (author name/avatar resolved
live). Errors: `400` wrong task scope / validation; `403` not author; `404` not found.

### `DELETE /collaboration/api/v1/comments/{taskId}/{commentId}`

Soft-delete a comment. Allowed for the comment author or the task owner. Plain system comments
cannot be deleted (the Author's Note is cleared by editing the task description to empty). Success
`204 No Content`. Errors: `403` not allowed; `404` not found.

## Messaging

Controller: `Services/MessagingApi/Planora.Messaging.Api/Controllers/MessagesController.cs`

Gateway prefix: `/messaging/api/v1/messages`

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/` | bearer | send message |
| `GET` | `?otherUserId=&page=1&pageSize=20` | bearer | get messages |
| `GET` | `/health` | public at service route | service-local health helper |

Send body:

```json
{
  "senderId": null,
  "subject": "Hello",
  "body": "Message body",
  "recipientId": "00000000-0000-0000-0000-000000000000"
}
```

The controller overwrites sender with current user context by sending `SenderId = null`.

Validation:

- `recipientId` required;
- `subject` required, max 200;
- `body` required, max 10000;
- `pageSize` max 100;
- explicit sender cannot equal recipient.

Success for send:

```json
{
  "messageId": "00000000-0000-0000-0000-000000000000",
  "createdAt": "2026-05-03T12:00:00Z"
}
```

## Realtime

Controllers:

- `Services/RealtimeApi/Planora.Realtime.Api/Controllers/ConnectionsController.cs`
- `Services/RealtimeApi/Planora.Realtime.Api/Controllers/NotificationsController.cs`

Gateway prefix for HTTP/websocket route: `/realtime/{everything}`

Service-local protected routes:

| Method | Service path | Gateway path | Auth | Purpose |
|---|---|---|---|---|
| `GET` | `/api/v1/connections/active` | `/realtime/api/v1/connections/active` | bearer | current user's active SignalR connections |
| `GET` | `/api/v1/connections/stats` | `/realtime/api/v1/connections/stats` | admin | total connection count |
| `POST` | `/api/v1/notifications/send` | `/realtime/api/v1/notifications/send` | bearer | send notification to current user |
| `POST` | `/api/v1/notifications/broadcast` | `/realtime/api/v1/notifications/broadcast` | admin | broadcast notification |

Notification body:

```json
{
  "message": "Saved",
  "type": "info"
}
```

SignalR:

- Hub path inside service: `/hubs/notifications`
- Gateway path: `/realtime/hubs/notifications`
- JWT can be supplied as `access_token` query parameter for `/hubs` paths.

## Health Endpoints

| URL | Expected response |
|---|---|
| `/health` | gateway health |
| `/auth/health` | Auth API health |
| `/todos/health` | Todo API health |
| `/categories/health` | Category API health |
| `/messaging/health` | Messaging API health |
| `/realtime/health` | Realtime API health |

Health routes are explicitly defined in Ocelot route files.

## Public API Not Found

No unauthenticated public CRUD API for todos, categories, messages, users, or realtime notifications was found. Public unauthenticated gateway routes are limited to health checks, auth entry points, CSRF token, password reset initiation/reset, token validation, and registration/login. Email verification GET is `[AllowAnonymous]` in `UsersController`, but the committed Ocelot users route is bearer-protected.
