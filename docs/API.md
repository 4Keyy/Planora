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

Ocelot route files currently set `RateLimitOptions.EnableRateLimiting` to `false` per route. Gateway `Program.cs` registers a limiter, but no `app.UseRateLimiter()` call was found there.

## Gateway Route Map

| Gateway route | Downstream service | Auth |
|---|---|---|
| `GET /health` | gateway | public |
| `GET /auth/health` | Auth API | public |
| `GET /todos/health` | Todo API | public |
| `GET /categories/health` | Category API | public |
| `GET /messaging/health` | Messaging API | public |
| `GET /realtime/health` | Realtime API | public |
| `/auth/api/v1/auth/{everything}` | Auth `AuthenticationController` | mixed |
| `/auth/api/v1/users/{everything}` | Auth `UsersController` | bearer at gateway; `VerifyEmailByToken` is `[AllowAnonymous]` in the service controller |
| `/auth/api/v1/friendships*` | Auth `FriendshipsController` | bearer |
| `/friendships*` | Auth `FriendshipsController` legacy route | bearer |
| `/auth/api/v1/analytics/{everything}` | Auth `AnalyticsController` | bearer |
| `/todos/api/v1/{everything}` | Todo API | bearer |
| `/categories/api/v1/{everything}` | Category API | bearer |
| `/messaging/api/v1/{everything}` | Messaging API | bearer |
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
| `POST` | `/me/2fa/confirm` | bearer + CSRF | confirm TOTP |
| `POST` | `/me/2fa/disable` | bearer + CSRF | disable TOTP |
| `GET` | `/me/sessions` | bearer | list sessions |
| `DELETE` | `/me/sessions/{tokenId}` | bearer + CSRF | revoke session |
| `POST` | `/me/sessions/revoke-all` | bearer + CSRF | revoke all sessions |
| `GET` | `/me/login-history?pageNumber=&pageSize=` | bearer | login history |
| `GET` | `/statistics` | admin | user statistics |
| `GET` | `/` | admin | paged users |
| `GET` | `/{userId}` | admin | user detail |

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
| `PATCH` | `/{id}/viewer-preferences` | non-owner viewer hidden/category preference |

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
  "sharedWithUserIds": []
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
  "status": "InProgress"
}
```

Rules:

- title required on create, max 200;
- validators allow description max 5000, EF config stores max 2000;
- expected date cannot be after due date;
- category must belong to current user;
- shared users must be accepted friends;
- `isPublic` is independent from `sharedWithUserIds`; public tasks are visible to all accepted friends, direct shares are visible to the selected accepted friends;
- non-owner friend-visible viewer can only change `status`;
- backend statuses are `Todo`, `InProgress`, `Done`; parser also accepts aliases.

Hidden toggle body:

```json
{ "hidden": true }
```

Viewer preference body:

```json
{
  "hiddenByViewer": true,
  "viewerCategoryId": "00000000-0000-0000-0000-000000000000",
  "updateViewerCategory": true
}
```

Hidden shared/public todos may return a redacted `TodoItemDto`; see [`features.md`](features.md#shared-todos-and-hidden-viewer-preferences).

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
