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

Which wrapper you get is decided by one rule: `ResultToActionResultFilter` (registered globally in
the Todo, Category and Messaging services) rewrites an action result **only when the object it
carries is still a `Result<T>`**. A controller that unwraps the handler itself — `Ok(result.Value)` —
never meets the filter, so its payload is the bare DTO.

| Shape | Returned by | Code |
|---|---|---|
| raw DTO or `PagedResult<T>` | every action that unwraps the handler itself: all of `TodosController` **except** `GET /todos/public`, all of `CommentsController`, messaging, realtime, auth | controller return code |
| `ApiResponse<T>` envelope (`success` / `data` / `meta`) | every action that hands the filter an unopened `Result<T>`: all four category routes, and `GET /todos/public` | `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Filters/ResultToActionResultFilter.cs` |
| bare `Error` object | explicit `BadRequest(result.Error)` / `NotFound(result.Error)` in `TodosController`, `CommentsController` and `CategoriesController.DeleteCategory` | controller return code |
| `ApiResponse<object>` failure, `Content-Type: application/problem+json` | anything that **throws**: `ForbiddenException`, `EntityNotFoundException`, `BusinessRuleViolationException`, FluentValidation failures, gRPC faults | `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Middleware/EnhancedGlobalExceptionMiddleware.cs` |

`ApiResponse<T>` envelope:

```json
{
  "success": true,
  "data": {},
  "meta": {
    "correlationId": "0HN7…",
    "timestamp": "2026-09-15T12:00:00Z",
    "version": "v1"
  }
}
```

`error` replaces `data` on failure; both are omitted when null.

Bare `Error` object — what a controller's own `BadRequest(result.Error)` writes. `type` is the
`ErrorType` enum as a number (`1` Validation, `2` NotFound, `3` Conflict, `4` Unauthorized,
`5` Forbidden, `6` Failure):

```json
{ "code": "AUTHOR_ALREADY_COMPLETED", "message": "Автор уже отметил…", "type": 6 }
```

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

Page arguments are normalised server-side by
`BuildingBlocks/Planora.BuildingBlocks.Application/Pagination/PaginationParameters.cs`: a page number
below 1 becomes 1, a page size below 1 becomes 10, and anything above 100 is clamped to 100. The
echoed `pageNumber` / `pageSize` are the normalised values, so a client that asked for 500 rows can
tell from the response that it got 100.

Frontend unwrapping code:

- `frontend/src/lib/api.ts:parseApiResponse` — accepts a raw body, a `value` wrapper or a `data` wrapper, so it works against all three success shapes
- `frontend/src/types/category.ts:toCategoryList`

### Rate Limits

Service-level rate limiting policies are configured in `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Extensions/ServiceCollectionExtensions.cs`.

| Policy | Limit | Applied |
|---|---:|---|
| `register` | 3 requests/minute/IP | `POST /auth/api/v1/auth/register` |
| `login` | 5 requests/minute/IP | `POST /auth/api/v1/auth/login` |
| `auth` | 10 requests/minute/IP | refresh/logout/validate-token/password reset |
| `data` | 50 requests/minute/IP | configured but no controller usage found in inspected routes |

Every route in both Ocelot files carries `"RateLimitOptions": { "EnableRateLimiting": false }` — Ocelot
throttles nothing. All gateway throttling comes from the ASP.NET Core limiter in
`Planora.ApiGateway/Program.cs`, applied by `app.UseRateLimiter()` ahead of authentication and Ocelot
so a rejected request never reaches JWT validation or a downstream service. It is a **chained**
partitioned limiter — a request must satisfy every window that applies to it:

| Window | Limit | Partition | Applies to |
|---|---:|---|---|
| global | 100 requests/minute | client IP | every gateway request |
| auth | 30 requests/minute | `auth:` + client IP | paths under `/auth/api/v1/auth` only; `OPTIONS` preflights bypass it |

Rejection is `429 Too Many Requests` with `Retry-After: 60` and the body
`{ "error": "Too many requests. Please try again later.", "retryAfter": 60 }`.

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
| `GET /avatars/{everything}` | Auth API static avatar files | public |
| `/auth/api/v1/auth/{everything}` | Auth `AuthenticationController` | mixed |
| `GET /auth/api/v1/users/verify-email` | Auth `UsersController.VerifyEmailByToken` | public — a dedicated route declared *before* the catch-all below, with no `AuthenticationOptions` |
| `/auth/api/v1/users/{everything}` | Auth `UsersController` | bearer at gateway |
| `/auth/api/v1/friendships*` | Auth `FriendshipsController` | bearer |
| `/friendships*` | Auth `FriendshipsController` legacy route | bearer |
| `/auth/api/v1/analytics/{everything}` | Auth `AnalyticsController` | bearer |
| `/todos/api/v1/{everything}` | Todo API | bearer |
| `/categories/api/v1/{everything}` | Category API | bearer |
| `/messaging/api/v1/{everything}` | Messaging API | bearer |
| `/collaboration/api/v1/{everything}` | Collaboration API (task comment timeline) | bearer |
| `/realtime/api/v1/{everything}` | Realtime API HTTP route (notifications + connections REST) | bearer |
| `/realtime/{everything}` | Realtime API websocket route (SignalR hub `/hubs/notifications`) | route-dependent |

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

| Method | Path | Success | Purpose |
|---|---|---|---|
| `GET` | `/` | `200` | list current user's categories |
| `POST` | `/` | `201` + `Location` | create category |
| `PUT` | `/{id}` | `200` | update category |
| `DELETE` | `/{id}` | `204` | delete category |

`GET`, `POST` and `PUT` hand the filter an unopened `Result<T>`, so all three answer with the
`ApiResponse<T>` envelope — the category payload is under `data`, not at the top level:

```json
{
  "success": true,
  "data": {
    "id": "00000000-0000-0000-0000-000000000000",
    "userId": "00000000-0000-0000-0000-000000000000",
    "name": "Work",
    "description": "Work tasks",
    "color": "#007BFF",
    "icon": "Briefcase",
    "displayOrder": 0,
    "createdAt": "2026-05-03T12:00:00Z",
    "updatedAt": null
  },
  "meta": { "correlationId": "0HN7…", "timestamp": "2026-05-03T12:00:00Z", "version": "v1" }
}
```

`GET /` puts the array of `CategoryDto` under the same `data` key. `frontend/src/types/category.ts:toCategoryList`
exists to flatten exactly this.

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

Update body carries the same fields, all optional; `categoryId` comes from the route and any value in
the body is overwritten.

`DELETE /{id}` is the one category route that maps error codes by hand:
`CATEGORY_NOT_FOUND` → `404` with the bare `Error`, `FORBIDDEN` → `403` with an empty body
(`Forbid()`), anything else → `400` with the bare `Error`.

## Todos

Controller: `Services/TodoApi/Planora.Todo.Api/Controllers/TodosController.cs`

Gateway prefix: `/todos/api/v1/todos`

All routes require bearer auth.

| Method | Path | Success | Body type | Purpose |
|---|---|---|---|---|
| `GET` | `?pageNumber=1&pageSize=10&status=&categoryId=&isCompleted=&includeSubtasks=false&completedFrom=&completedTo=` | `200` | `PagedResult<TodoItemDto>` | list own and friend-visible todos |
| `GET` | `/public?pageNumber=1&pageSize=10&friendId=` | `200` | `ApiResponse<PagedResult<TodoItemDto>>` | list public or directly shared friend todos |
| `GET` | `/{id}` | `200` | `TodoItemDto` | get one todo |
| `POST` | `/` | `201` + `Location` | `TodoItemDto` | create todo |
| `PUT` | `/{id}` | `200` | `TodoItemDto` | update todo — a field-wise merge, not a replace |
| `DELETE` | `/{id}` | `204` | — | soft-delete a task and its whole subtask subtree |
| `PATCH` | `/{id}/hidden` | `200` | `TodoHiddenResponseDto` | owner hidden toggle |
| `PATCH` | `/{id}/viewer-preferences` | `200` | `ViewerPreferenceResponseDto` | non-owner viewer hidden/category/completion preference (viewer reopen allowed unless author completed globally — see below) |
| `POST` | `/{id}/join` | `200` | `TodoItemDto` | join task as a worker |
| `POST` | `/{id}/leave` | `204` | — | leave task (stop being a worker) |
| `POST` | `/{id}/duplicate` | `201` + `Location` | `TodoItemDto` | duplicate a task into a fresh active copy (any participant) |
| `GET` | `/{id}/subtasks` | `200` | `TodoItemDto[]` | list a task's subtasks (anyone with parent access) |
| `POST` | `/{id}/subtasks` | `201` + `Location` | `TodoItemDto` | create a subtask (owner **or any participant**; category/visibility inherited) |

`GET /public` is the only Todo route that returns the `ApiResponse` envelope — its controller action
hands the filter an unopened `Result<T>`, so the page sits under `data`. Every other route on this
table unwraps itself and answers with the bare DTO.

> **Comments (the task timeline) moved to the Collaboration service** — see the
> [Collaboration](#collaboration) section. The old `/{id}/comments*` and `/{id}/genesis`
> routes under `/todos/api/v1/todos` no longer exist.

### Todo status codes and error bodies

Two different failure paths serve this controller, and they produce different bodies.

Handlers **throw** for every access and existence failure. The exception middleware turns those into
the `ApiResponse` failure envelope with `Content-Type: application/problem+json`:

| Thrown by a handler | Status | `error.code` |
|---|---:|---|
| `EntityNotFoundException` — task missing, soft-deleted, or a subtask where one is not addressable | `404` | `NOT_FOUND.RESOURCE` |
| `ForbiddenException` — no access, non-friend, foreign category, non-owner editing more than `status` | `403` | `AUTHORIZATION.FORBIDDEN` |
| `BusinessRuleViolationException` — worker capacity full, owner leaving their own task | `409` | `BUSINESS.RULE_VIOLATION` |
| `InvalidValueObjectException` — `requiredWorkers` out of range, due-range inversion | `400` | `VALIDATION.INVALID_INPUT` |
| FluentValidation failure on the command | `400` | validator's code |
| gRPC `Unavailable` from Category or Auth | `503` | `INFRASTRUCTURE.*` |

Handlers **return** a failure `Result` only for the two per-viewer conflicts below, and the controller
writes those with `BadRequest(result.Error)` — so they arrive as **`400` with the bare `Error`
object**, not the envelope, regardless of how conflict-shaped they are:

| `code` | Route |
|---|---|
| `OWNER_MUST_USE_HIDDEN_ENDPOINT` | `PATCH /{id}/viewer-preferences` called by the owner |
| `INVALID_VIEWER_PREFERENCE_REQUEST` | `PATCH /{id}/viewer-preferences` with no field set |
| `AUTHOR_ALREADY_COMPLETED` | `PATCH /{id}/viewer-preferences` and `PUT /{id}` viewer-reopen |
| `AUTH_REQUIRED`, `NOT_FRIENDS`, `QUERY_FAILED` | `GET /public` (these three go through the filter instead, so they arrive as an envelope) |

The `[ProducesResponseType]` attributes on `TodosController` advertise `403`/`404` on some actions
whose own failure branch writes `400`. Trust the table above: the `403`s and `404`s really do come
from the middleware, not from those branches.

### List filters

`status` accepts a **comma-separated list** (`status=Todo,InProgress`). Each entry is parsed
case-insensitively with spaces stripped, and an unparseable entry is dropped rather than rejected —
`status=nonsense` is the same request as no filter at all.

`includeSubtasks` (default `false`) is the only way to see subtasks in a task list: every list query
filters to `parentTodoId == null` unless it is set. The dashboard statistics fetch opts in so
completed subtasks still count toward the weekly numbers, then filters them out of the displayed grid
by `parentTodoId`. `GET /public` has no such switch — it always excludes subtasks.

`completedFrom` / `completedTo` are an **optional, inclusive completion-date window** (ISO 8601
instants) used by the completed archive's "find a task by roughly when it was finished" search. Each
bound is normalized to UTC server-side and compared against `CompletedAt`; either may stand alone
(open-ended on the missing side). A task with no `CompletedAt` is excluded the moment either bound is
set. The bounds combine with `isCompleted=true` and the other filters. The frontend sends the local
day edges (start-of-day → end-of-day) so a single calendar day matches every task finished that day
regardless of the stored time-of-day.

Ordering is newest-first by `createdAt`, except when the query asks only for completed tasks
(`isCompleted=true`, or a `status` list containing nothing but `Done`) — then it is newest-first by
`completedAt`, falling back to `updatedAt` and `createdAt`.

### Which fields are populated on which read

`TodoItemDto` is one record served by nine handlers, and four of its members are explicitly
`Ignore()`d in the AutoMapper profile (`Services/TodoApi/Planora.Todo.Application/DTOs/TodoItemDto.cs`)
because they cannot be read off the entity — they are resolved live, and only by the handlers that
need them. On every other endpoint the field is present in the JSON at its **zero value**, which is
indistinguishable from "this task genuinely has none". A client that reads `workers: []` off a list
row and concludes nobody is working on the task is wrong.

| Field | Populated by | Value everywhere else |
|---|---|---|
| `workers` (`[{ userId, name, avatarUrl }]`) | `GET /{id}/subtasks` only — resolved from Auth in the same batch call as the author labels, ordered oldest-join first | `[]` |
| `authorName`, `authorAvatarUrl` | `GET /{id}/subtasks` (batch lookup keyed by `createdByUserId ?? userId`) and `POST /{id}/subtasks` (from the caller's own JWT — the creator is the caller) | `null` |
| `openSubtaskCount` | `GET /todos` and `GET /todos/{id}` — one grouped query per page. Always `0` for a subtask, and `0` on the masked shape a hidden task returns | `0` |

Two consequences worth stating plainly:

- **Worker identities do not exist outside the subtask read.** A top-level task carries only
  `workerUserIds` and `workerCount`. That is why the frontend resolves worker names client-side from
  the already-loaded friend list (`frontend/src/components/todos/edit-todo-modal/modal.tsx`) instead
  of reading `workers` — enriching a 100-row page server-side would be an identity lookup per task.
- **Author labels do not exist outside subtask reads either.** The Auth batch call is failure-tolerant:
  if Auth is down the read still succeeds and the labels are simply `null`.

Three more fields are per-read in the same way, though they are mapped rather than ignored:

| Field | Populated by | Value everywhere else |
|---|---|---|
| `isCompletedByViewer` | `GET /todos` (non-owner rows) and the `PUT /{id}` viewer-completion path | `null` — including on `GET /todos/{id}` |
| `categoryName` / `categoryColor` / `categoryIcon` | `GET /todos`, `GET /todos/{id}`, `GET`/`POST /{id}/subtasks`, `POST /todos`, `POST /{id}/duplicate`, and `PUT /{id}` for the owner | `null` — `POST /{id}/join` does no category lookup at all, and every non-owner branch of `PUT /{id}` blanks `categoryId` along with the three labels, because the owner's category is not the viewer's to see |
| `authorCategoryName` / `authorCategoryColor` / `authorCategoryIcon` | `GET /todos` and `GET /todos/{id}`, and only for a task the caller does not own | `null` |

`GET /public` is the thinnest projection of all: it hides the owner's `categoryId` (always `null`),
and drops `dueDateStart`, `createdByUserId`, `parentTodoId`, `isCompletedByViewer` and every field in
both tables above. It does carry `ownerCompleted`, `workerCount`, `workerUserIds`, `requiredWorkers`
and the viewer-relative `isWorking`.

Create body:

```json
{
  "userId": null,
  "title": "Pay bills",
  "description": "Electricity and internet",
  "categoryId": "00000000-0000-0000-0000-000000000000",
  "dueDate": "2026-05-10T12:00:00Z",
  "dueDateStart": "2026-05-08T12:00:00Z",
  "expectedDate": "2026-05-09T12:00:00Z",
  "priority": 3,
  "isPublic": false,
  "sharedWithUserIds": [],
  "requiredWorkers": 3
}
```

The all-zero GUID stands in for a real id in these examples, but it is not inert: both create and
update read `00000000-0000-0000-0000-000000000000` in `categoryId` as "no category", the same as
`null` on create and as an explicit clear on update.

`userId` is overwritten with the caller's JWT subject before the command reaches the handler; send
`null` or omit it. `dueDate` is the estimated-completion date — a single target date, or the
**later** bound (deadline) of an interval. `dueDateStart` is the optional **earlier** bound: omit it
(or send `null`) for a single date; when present it must be `≤ dueDate`. A create never sets
`actualDate` or `status`; a new task starts `Todo`.

`priority` must be sent as a **number**: `VeryLow` = 1, `Low` = 2, `Medium` = 3 (the default),
`High` = 4, `Urgent` = 5. No service registers a `JsonStringEnumConverter`, so `"priority": "Medium"`
fails model binding. The DTO nonetheless **returns the name** as a string — the AutoMapper profile
projects `Priority.ToString()` — so the field you read back is not the field you send.

Update body fields are optional:

```json
{
  "title": "Updated title",
  "description": "Updated description",
  "categoryId": null,
  "dueDate": "2026-05-10T12:00:00Z",
  "dueDateStart": "2026-05-08T12:00:00Z",
  "clearDueDate": false,
  "expectedDate": null,
  "actualDate": null,
  "priority": 4,
  "isPublic": true,
  "sharedWithUserIds": ["00000000-0000-0000-0000-000000000000"],
  "status": "InProgress",
  "requiredWorkers": 3,
  "clearRequiredWorkers": false
}
```

### `PUT /todos/api/v1/todos/{id}` is a merge, not a replace

The handler tests each field of `UpdateTodoCommand` on its own and applies only the ones that carry a
value. **An omitted field leaves the stored value alone.** There is no branch that writes a default
over an unsent field, so a body of `{ "priority": 4 }` changes the priority and nothing else.

What that means per field — and, where a field can be cleared, how:

| Field | Omitted / `null` | Cleared by |
|---|---|---|
| `title` | unchanged (empty string is also treated as unchanged, so a title can never be blanked here) | — |
| `description` | unchanged | `""` — the check is `!= null`, so an empty string writes an empty description |
| `categoryId` | unchanged | `"00000000-0000-0000-0000-000000000000"` (all-zero GUID) |
| `dueDate`, `dueDateStart` | unchanged | `clearDueDate: true` — wipes both bounds together |
| `expectedDate`, `actualDate` | unchanged | nothing: these have no clear flag and cannot be removed through this endpoint |
| `priority`, `isPublic`, `requiredWorkers` | unchanged | `clearRequiredWorkers: true` for the last one |
| `sharedWithUserIds` | unchanged | `[]` — a non-null array **replaces** the whole audience |
| `status` | unchanged (empty string too) | — |

`clearDueDate` and `clearRequiredWorkers` exist because `null` already means "unchanged" for those
fields, leaving no way to express "remove it". They are the explicit erase signal, and they win over
any value sent alongside them.

The trap is the other direction. The editor's owner autosave is debounced but sends the **whole
task**, not a diff, which is safe for the fields above and destructive for the two a full payload
always fills in: `sharedWithUserIds: []` silently un-shares the task, and a full payload built from a
task with no date must set `clearDueDate: true` or it drops the very date it meant to preserve.
`frontend/src/components/todos/edit-todo-modal/utils.ts:todoToOwnerPayload` builds that complete,
correct payload once so the editor and the task list's priority shortcut cannot disagree about it.

A **non-owner** with friend-visible access may send `status` and nothing else. Any other field in the
body — including `clearDueDate` or `clearRequiredWorkers` set to `true` — is rejected with `403`
before anything is written. On a top-level task their `status` change does not touch the owner's
record: it writes `UserTodoViewPreference.CompletedByViewer` instead, and the response reports
`isCompletedByViewer` with `categoryId` and the category labels blanked. On a **subtask** the same
call is global — subtask completion lives on the entity and is the same for every viewer, so a
collaborator marking a subtask done marks it done for everyone.

A **subtask** rejects `categoryId`, `isPublic`, `sharedWithUserIds`, both due-date fields,
`expectedDate` and both `requiredWorkers` fields with `403` — it inherits all of them from its parent.
Its owner, or the collaborator who created it, may still change `title`, `description`, `priority` and
`status`.

Rules:

- title required on create, max 200 for a regular task; **subtask titles allow up to 1500** (a subtask's whole content lives in its title — see `POST /todos/{id}/subtasks`). The shared update endpoint (`PUT /todos/{id}`) also accepts up to 1500 because subtask renames go through it;
- description optional, max 2000 (validators and the EF column agree);
- expected date cannot be after due date;
- `dueDateStart` (interval start) requires `dueDate` to be set and must be `≤ dueDate`; the later bound is always the deadline. On update, a bare `dueDate: null` means **unchanged** (the full-payload autosave always sends it) — send `clearDueDate: true` to actually remove the date/interval, mirroring `clearRequiredWorkers`;
- category must belong to current user;
- shared users must be accepted friends;
- `isPublic` is independent from `sharedWithUserIds`; public tasks are visible to all accepted friends, direct shares are visible to the selected accepted friends;
- non-owner friend-visible viewer can only change `status`;
- `requiredWorkers` must be ≥ 1 when set, and **whenever the task has any direct shares** it cannot
  exceed `1 + sharedWith.Count` (the owner occupies one slot). The cap is keyed on the shared list,
  not on `isPublic`: a public task with no direct shares has no ceiling. Lowering it evicts the
  most-recently-joined workers until the count fits;
- set `clearRequiredWorkers: true` to remove the capacity limit on update.

`status` on the wire is asymmetric. **Accepted on input**, case-insensitively and with spaces
stripped: `todo`, `pending`, `inprogress`, `done`, `completed`. An unrecognised value is **ignored**,
not rejected — the task keeps its status and the call still returns `200`. **Returned in the DTO** is
the display form: `"Todo"`, `"In Progress"` (with a space) or `"Done"`. A client that round-trips
`status` gets `"In Progress"` back, which parses correctly on the way in again.

`TodoItemDto` worker fields:

```json
{
  "requiredWorkers": 3,
  "workerCount": 1,
  "isWorking": true,
  "workerUserIds": ["00000000-0000-0000-0000-000000000000"]
}
```

On a **top-level task the owner is never counted**: they are implicitly the primary worker and hold
no worker row, so `workerCount` and `workerUserIds` cover collaborators only. Capacity follows from
that — a task with `requiredWorkers: 3` is full at `workerCount == 2`, because the owner already
occupies one of the three slots. On a **subtask** every participant including the owner opts in
individually, so the owner does appear in both fields.

`isWorking` is viewer-relative and computed differently per endpoint, so do not read it as a property
of the task:

| Endpoint | `isWorking` means |
|---|---|
| `GET /todos`, `GET /todos/{id}`, `GET /public` | the caller is a **non-owner** holding a worker row — always `false` for the owner of a top-level task, even though they are working on it |
| `GET /{id}/subtasks` | the caller holds a worker row, owner included |
| `POST /{id}/join` | always `true` — including the owner short-circuit, where no row was written |

`TodoItemDto` subtask aggregate:

```json
{
  "openSubtaskCount": 2
}
```

- `openSubtaskCount` is the number of this task's subtasks that are still **open** (not `Done`, not
  deleted). `0` when the task has no subtasks or every subtask is finished. It is computed with a
  single grouped query and surfaced by the list endpoint (`GET /todos`) and the detail endpoint
  (`GET /todos/{id}`); other list endpoints that skip the enrichment return `0`. Always `0` for a
  subtask (subtasks have no children). The frontend uses it to warn before finishing a task that
  still has unfinished subtasks.

Hidden toggle body — owner only, `403` for anyone else:

```json
{ "hidden": true }
```

The response is **not** a `TodoItemDto`. It is `TodoHiddenResponseDto`:

```json
{
  "id": "00000000-0000-0000-0000-000000000000",
  "hidden": true,
  "categoryName": "Work",
  "categoryId": "00000000-0000-0000-0000-000000000000"
}
```

Where the flag is written depends on the task's audience. A task that is public or has any direct
share stores the owner's hidden state in their own `UserTodoViewPreference` row — and clears any
legacy global `Hidden` flag on the way, so an old value cannot leak to other viewers. A task with no
audience at all sets `TodoItem.Hidden` directly.

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
- `completedByViewer: false` (reopen) is **allowed** — a viewer may return *their own* completion to
  active — **unless the author has completed the whole task globally** (`Status == Done`). In that
  case the task is closed for everyone and the request fails with
  `{ "code": "AUTHOR_ALREADY_COMPLETED" }` ("Автор уже отметил задачу выполненной …"); the viewer's
  path on an author-closed task is `POST /{id}/duplicate`. The same rule is enforced on the
  `PUT /todos/{id}` status path (a non-owner sending `status: "todo"`), so neither route can bypass it.
- At least one of `hiddenByViewer`, `updateViewerCategory` or `completedByViewer` must be present, or
  the call fails with `INVALID_VIEWER_PREFERENCE_REQUEST`. `viewerCategoryId` is only read when
  `updateViewerCategory` is `true`, which is how "set my category to none" (an all-zero GUID or
  `null`) is told apart from "leave my category alone".
- The category, when set, must belong to the **caller**, not the task's author — a foreign one is
  `403`.

The response is `ViewerPreferenceResponseDto`, not a `TodoItemDto`:

```json
{
  "todoId": "00000000-0000-0000-0000-000000000000",
  "hiddenByViewer": true,
  "viewerCategoryId": "00000000-0000-0000-0000-000000000000",
  "completedByViewer": true,
  "ownerCompleted": false
}
```

- It carries **`ownerCompleted`** — the author's real completion truth (the entity's global
  `Status == Done`), independent of any per-viewer completion. Clients use it to show the correct
  reopen affordance and avoid sending a request the server will reject. `TodoItemDto` carries the
  same field, mapped straight from the entity, on every read that goes through the AutoMapper profile.

### `POST /{id}/join`

Join the task as a worker. Access mirrors the read rule: the task must be public or directly shared
with the caller, and a **non-public** shared task additionally requires friendship with the owner.

The call is **idempotent**, and two cases that look like errors are not:

- Joining a task you already work on returns `200` with the current state, not a conflict.
- The **owner** of a top-level task gets `200` with `isWorking: true` without a worker row being
  written — the owner is implicitly the primary worker and never holds one.
- A **subtask** is different: its in-work state is per-user for everybody, the owner included, so an
  owner joining a subtask really does take a worker row.

Success `200`: the updated `TodoItemDto` with `isWorking: true`. Category labels are not resolved on
this path, so `categoryName` / `categoryColor` / `categoryIcon` come back `null`.

Errors: `403` if the task is not visible to the caller or friendship is missing; `404` if the task
does not exist; `409 BUSINESS.RULE_VIOLATION` when the task is already at `requiredWorkers` capacity.
A capacity race is caught a second time at the database: joining touches the parent row so the loser
of two simultaneous joins fails the optimistic-concurrency check rather than overfilling the task.

### `POST /{id}/leave`

Leave a task. The owner of a top-level task cannot leave it (`409`), because they were never a worker
row to begin with; the owner of a **subtask** can, since subtask membership is per-user for everyone.

Success `204 No Content`, with no body.

Errors: `404` if the task does not exist **or the caller holds no worker row on it** — the domain
raises `EntityNotFoundException` for the missing membership, so a redundant leave is a `404`, not a
no-op; `409` for a top-level owner trying to leave.

### `POST /{id}/duplicate`

Duplicate a task into a brand-new **active** task owned by the caller. **Open to any participant** —
the owner, or a friend who can see the task (public or directly shared) — so a non-owner can fork a
completed task instead of reopening it (returning a task to work is author-only). The server authors
the copy and copies the task's content — title, description, priority, category (re-validated against
the duplicator; dropped if not theirs or since-deleted), visibility (`isPublic`), shared audience
(re-validated against the **duplicator's** current friendships — others dropped), tags, and
`requiredWorkers`. It deliberately does **not** copy any of the dates (`dueDate`, `dueDateStart`,
`expectedDate`, `actualDate`), the completion state (the copy starts active), or the **branch**
(comments / subtasks). The copy emits the same `TaskCreatedIntegrationEvent` a normal create does, so
the new branch's "created" system comment and all participant notifications fire.

No request body. Success `201 Created`: the new `TodoItemDto` (with category info populated). Errors:
`403` if the caller cannot access the task (not the owner and not a friend who can see a public/shared
task); `404` if the task does not exist or is a subtask (subtasks have no standalone existence to
duplicate); `503` if the Category/Auth gRPC checks are unavailable.

### Subtasks

A subtask is a `TodoItem` with `parentTodoId` set. It inherits its parent's category, `isPublic` flag
and shared audience, and re-inherits them whenever the parent's change; it never has dates of its own.
Subtasks are excluded from every task list unless `includeSubtasks=true`, and cannot nest — a subtask
may not have subtasks.

`GET /{id}/subtasks` returns a plain `TodoItemDto[]` (no paging). Access mirrors `GET /{id}`: the
owner, or a friend who can see a public/shared parent. `404` when the parent does not exist **or is
itself a subtask**; `403` when the caller has no access. This is the only read that resolves live
identities — `workers[]`, `authorName` and `authorAvatarUrl` — in one batched Auth call per request.
The call is failure-tolerant: if Auth is unavailable the subtasks still come back and the labels are
`null`.

The author shown for a subtask is whoever **added** it (`createdByUserId`), not the parent's owner —
a collaborator's subtask is filed under the parent owner for access purposes but attributed to its
creator. Rows created before `createdByUserId` was recorded fall back to `userId`.

`POST /{id}/subtasks` is open to the **owner or any participant** who can see the parent, because
collaborators contribute steps to a task they are working on. The parent id comes from the route; any
`parentTodoId` in the body is overwritten.

```json
{ "title": "Call the supplier", "description": null, "priority": 3 }
```

`title` is required and may run to **1500 characters** — a subtask's whole content lives in its title,
which is also why `PUT /todos/{id}` accepts 1500 (subtask renames go through it) while a regular task
is capped at 200 by the create validator. Success `201 Created`, with `authorName` /
`authorAvatarUrl` taken from the caller's own JWT claims, and the parent's category resolved for
display. Errors: `403` if the caller cannot see the parent or the parent is itself a subtask; `404`
if the parent does not exist.

Creating a subtask posts no system comment in the parent's branch, but it does notify every other
participant (`subtask.added`) and pushes a live branch refresh.

Deleting a parent soft-deletes its whole subtask subtree in the same unit of work. A subtask can also
be deleted on its own by its creator as well as by the parent's owner, and that removes exactly the
announcement comments it left in the parent's branch — not a branch of its own, which it never had.

Hidden shared/public todos may return a redacted `TodoItemDto`; see [`features.md`](features.md#shared-todos-and-hidden-viewer-preferences).

### The redacted shape of a hidden todo

When a task is hidden and either the viewer is not its owner or the task has an audience, the read
handlers return a **masked** `TodoItemDto` instead of the real one
(`Services/TodoApi/Planora.Todo.Application/Features/Todos/HiddenTodoDtoFactory.cs`). The mask is not
a flag the client should interpret — the data is genuinely not in the response:

| Field | Masked value |
|---|---|
| `title` | `"Hidden task"` |
| `userId` | all-zero GUID for a non-owner; the real owner id for the owner |
| `status` | `""` |
| `isCompleted` | `false` |
| `createdAt` | `0001-01-01T00:00:00` (`DateTime.MinValue`) |
| `description`, `tags`, `sharedWithUserIds`, every date, every worker field | empty, null or zero |
| `ownerCompleted`, `isCompletedByViewer`, `openSubtaskCount` | `false` / `null` / `0` regardless of the truth |
| `hidden`, `isPublic`, `priority`, `hasSharedAudience`, `isVisuallyUrgent` | real values |
| `categoryId` + labels | the **viewer's own** category for the task, not the author's |

## Collaboration

Gateway prefix: `/collaboration/api/v1/comments`. All routes require bearer auth.

The Collaboration service owns the task **comment timeline**. It does not own tasks:
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
participant; the quoted author receives a dedicated `comment.reply` notification ("… replied to your
message/subtask") instead of the generic `comment.added`. Errors: `400` validation / invalid reply
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

| Method | Path | Auth | Success | Purpose |
|---|---|---|---|---|
| `POST` | `/` | bearer | `201` + `Location` | send message |
| `GET` | `?otherUserId=&page=1&pageSize=20` | bearer | `200` | get messages |
| `GET` | `/health` | public at service route | `200` | service-local health helper |

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

Send returns `201 Created` with a `Location` header and the bare `SendMessageResponse` — the handler
returns a plain DTO, not a `Result<T>`, so the filter leaves it alone:

```json
{
  "messageId": "00000000-0000-0000-0000-000000000000",
  "createdAt": "2026-05-03T12:00:00Z"
}
```

`GET` returns `PagedResult<MessageDto>`, also unwrapped, newest-first by `createdAt`. A `MessageDto`
carries `id`, `subject`, `body`, `senderId`, `recipientId`, `readAt`, `isArchived` and `createdAt`.
The query is strictly one conversation — messages between the caller and `otherUserId` in either
direction — so omitting `otherUserId` substitutes an all-zero GUID and returns an empty page rather
than every message the caller has.

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
| `GET` | `/api/v1/notifications/summary` | `/realtime/api/v1/notifications/summary` | bearer | unread total + per-task breakdown (card dots, branch badges, bell count) |
| `GET` | `/api/v1/notifications` | `/realtime/api/v1/notifications` | bearer | paged notification list, newest first (bell dropdown); `?take=&before=` |
| `POST` | `/api/v1/notifications/read` | `/realtime/api/v1/notifications/read` | bearer | mark read by `{ all }`, `{ taskId }`, or `{ ids }`; returns fresh summary |
| `POST` | `/api/v1/notifications/send` | `/realtime/api/v1/notifications/send` | admin | operator/diagnostic self-notify; admin-only, non-security types only |
| `POST` | `/api/v1/notifications/broadcast` | `/realtime/api/v1/notifications/broadcast` | admin | broadcast notification |

Every notification endpoint is scoped to the JWT subject server-side — a user can only ever read or
mark read **their own** notifications (no IDOR surface), and all reads are `AsNoTracking`.

`GET /notifications/summary` response (drives every inline indicator in one round trip):

```json
{
  "totalUnread": 4,
  "perTask": [
    {
      "taskId": "11111111-1111-1111-1111-111111111111",
      "count": 3,
      "latestType": "task.review",
      "groups": [
        { "type": "task.review",  "count": 1, "latestOccurredOnUtc": "2026-06-24T12:05:00Z" },
        { "type": "comment.added", "count": 2, "latestOccurredOnUtc": "2026-06-24T12:01:00Z" }
      ]
    }
  ]
}
```

`groups` is the per-type breakdown that drives the card's notification badge cluster, ordered by
`latestOccurredOnUtc` descending (newest type first). `count` / `latestType` are retained for
backward compatibility — `latestType === groups[0].type`.

`POST /notifications/read` request (exactly one selector, priority `all` → `taskId` → `ids`):

```json
{ "taskId": "11111111-1111-1111-1111-111111111111" }
```

`POST /notifications/send` body (admin-only operator tool — the production path is the gRPC/bus
channel). `type` must be a non-security UI type (`info`, `success`, `warning`, `error`,
`TodoCreated`/`TodoUpdated`/`TodoDeleted`, `FriendRequest`, `FriendAccepted`); security types such as
`PasswordChanged` and `AccountLocked` are rejected with `400 INVALID_NOTIFICATION_TYPE` so a client can
never spoof a security alert into a session:

```json
{ "message": "Saved", "type": "info" }
```

SignalR:

- Hub path inside service: `/hubs/notifications`
- Gateway path: `/realtime/hubs/notifications`
- JWT can be supplied as `access_token` query parameter for `/hubs` paths.
- The hub multiplexes three streams over one socket: `ReceiveNotification` (per-user notifications),
  `TaskFeedChanged` / `BranchChanged` (live data-sync), and `UserTyping` / `UserStoppedTyping`.

`ReceiveNotification` payload (the full persisted shape — the client renders the toast, lights the
right card/branch indicator and decides on an OS notification without a follow-up fetch):

```json
{
  "id": "…", "userId": "…", "taskId": "…", "actorId": "…",
  "type": "task.review", "title": "Ready for review",
  "message": "Everyone finished \"Launch plan\" — it's ready for your review",
  "occurredOnUtc": "2026-06-16T09:00:00Z", "isRead": false
}
```

Notification `type` discriminators (the actor is **always excluded** from recipients):

| `type` | Raised when | Recipients | OS notification |
|---|---|---|---|
| `comment.added` | new branch message | other participants | no |
| `comment.reply` | a reply targets you | the quoted author | yes |
| `subtask.added` | subtask created | other participants | no |
| `subtask.completed` | subtask marked done | other participants | no |
| `task.started` | someone takes the task into work | other participants | no |
| `task.completed` | a collaborator/owner completes a public/shared task | the others | yes |
| `task.review` | **all** participants (≠author) done **and all subtasks done** | author only | yes |
| `task.participants_done` | all participants (≠author) done **but subtasks remain** | author only | yes |

Two details the `taskId` field makes easy to get wrong:

- `subtask.added` and `subtask.completed` carry the **parent's** id in `taskId`, never the subtask's.
  A subtask has no branch of its own, so its events belong to the parent's.
- When a collaborator's completion is the one that triggers `task.review` or `task.participants_done`,
  the author is **excluded** from the accompanying `task.completed` fan-out — one completion never
  produces two notifications for the same person.

`task.started` fires only for top-level tasks. Joining or leaving a **subtask** posts no notification
and no branch entry at all; its in-work state is carried by the live `SubtaskChanged` sync instead.

## Health Endpoints

| URL | Expected response |
|---|---|
| `/health` | gateway health |
| `/auth/health` | Auth API health |
| `/todos/health` | Todo API health |
| `/categories/health` | Category API health |
| `/messaging/health` | Messaging API health |
| `/collaboration/health` | Collaboration API health |
| `/realtime/health` | Realtime API health |

Health routes are explicitly defined in both Ocelot route files, ahead of the authenticated routes and
without `AuthenticationOptions`.

## Public API Not Found

No unauthenticated public CRUD API for todos, categories, messages, users, or realtime notifications
exists. Nine routes carry no `AuthenticationOptions`, identically in both Ocelot files — the six
health checks, `GET /avatars/{everything}` (static avatar files), the whole
`/auth/api/v1/auth/{everything}` prefix, and `GET /auth/api/v1/users/verify-email`, a dedicated route
declared before the bearer-protected `/auth/api/v1/users/{everything}` catch-all so it matches the
`[AllowAnonymous]` on `UsersController.VerifyEmailByToken`.

The auth prefix being unauthenticated *at the gateway* is not the same as being public: the gateway
simply does not validate a token there, and `AuthenticationController` still applies `[Authorize]`
where it must — `logout` is the one that needs it. Everything else on that prefix is genuinely public
by design (CSRF token, register, login, refresh, validate-token, password reset request and reset).
