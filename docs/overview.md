# Overview

Planora is a personal productivity and sharing system. The visible product is a Next.js web app; the backend is split into .NET 9 services behind an Ocelot API Gateway.

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
| Direct messages | implemented | `Services/MessagingApi/Planora.Messaging.Api/Controllers/MessagesController.cs` |
| Realtime notification primitives | implemented | `Services/RealtimeApi/Planora.Realtime.Api/Controllers`, `Services/RealtimeApi/Planora.Realtime.Api/Hubs` |
| Product analytics event intake | implemented as structured business logging, not third-party analytics | `Services/AuthApi/Planora.Auth.Api/Controllers/AnalyticsController.cs`, `BuildingBlocks/Planora.BuildingBlocks.Application/Services/IBusinessEventLogger.cs` |

## Audiences

Planora documentation is written for four groups:

| Audience | What they need |
|---|---|
| User | Understand what the app does and how to run it locally. |
| New developer | Understand service boundaries, frontend flow, API routes, and data ownership. |
| Experienced engineer | Evaluate architecture, failure modes, security model, database boundaries, and extension points. |
| Contributor | Know how to add features safely and what tests/checks to run. |

## Domain Concepts

| Concept | Meaning | Code |
|---|---|---|
| User | Auth-owned account with profile, roles, security settings, sessions, and soft delete state | `Services/AuthApi/Planora.Auth.Domain/Entities/User.cs` |
| Refresh token | Long-lived credential stored server-side and sent to the browser as an httpOnly cookie | `Services/AuthApi/Planora.Auth.Domain/Entities/RefreshToken.cs` |
| Friendship | Auth-owned relation between requester and addressee with request status | `Services/AuthApi/Planora.Auth.Domain/Entities/Friendship.cs` |
| Todo item | Task owned by one user, optionally categorized, shared, completed, or hidden | `Services/TodoApi/Planora.Todo.Domain/Entities/TodoItem.cs` |
| Todo share | Explicit relation that grants another user access to a todo | `Services/TodoApi/Planora.Todo.Domain/Entities/TodoItemShare.cs` |
| Viewer preference | Per-viewer hidden/category state for shared todos | `Services/TodoApi/Planora.Todo.Domain/Entities/UserTodoViewPreference.cs` |
| Category | User-owned label with name, description, color, icon, and order | `Services/CategoryApi/Planora.Category.Domain/Entities/Category.cs` |
| Message | Direct message with sender, recipient, subject, body, read/archive metadata | `Services/MessagingApi/Planora.Messaging.Domain/Entities/Message.cs` |
| Integration event | RabbitMQ-delivered event used for async cross-service work | `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Messaging/Events` |

## Main User Scenarios

### Manage Personal Tasks

The user creates categories, creates todos, assigns category/priority/dates, filters active tasks, and views completed tasks. The frontend pages are `frontend/src/app/todos/page.tsx`, `frontend/src/app/todos/completed/page.tsx`, and `frontend/src/app/categories/page.tsx`; backend behavior is in `TodosController.cs` and `CategoriesController.cs`.

### Share Tasks With Friends

The user sends a friend request, the other user accepts, and then todos can be shared with accepted friends. The frontend exposes all-friends visibility inside `Share With`, while selected-friend sharing persists `TodoItemShare` rows. Todo creation/update checks the accepted friend list via Auth gRPC before persisting direct shares.

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
- `frontend/src/app/todos/page.tsx`

### Restore A Browser Session

The frontend persists user metadata and expiration timestamps in session storage, but not the raw access token or refresh token. On reload, it validates the in-memory token if present or calls the refresh endpoint using the httpOnly cookie.

Implementation:

- `frontend/src/store/auth.ts`
- `frontend/src/lib/auth-public.ts`
- `Services/AuthApi/Planora.Auth.Api/Controllers/AuthenticationController.cs`

## Current Boundaries

Confirmed service ownership:

- Auth owns users, roles, sessions, refresh tokens, login history, password history, friendships, audit logs, and auth-side outbox/inbox tables.
- Todo owns todo items, tags, shares, and viewer preferences.
- Category owns categories.
- Messaging owns messages and messaging-side outbox/inbox tables.
- Realtime owns in-memory/Redis-backed connection state and SignalR fan-out; no Realtime database was found.
- Gateway owns public routing and ingress-level JWT/rate/CORS behavior.

## Confirmed Limitations

| Limitation | Evidence |
|---|---|
| Production hosting target and deploy automation are not committed. | `docker-compose.yml`, `.github/workflows/ci.yml`, `.github/workflows/e2e.yml` |
| No external analytics SDK/table was found; analytics events are allowlisted and logged through business logging. | `AnalyticsController.cs`, `IBusinessEventLogger.cs`, `frontend/src/lib/analytics.ts` |
| Realtime has no dedicated database context. | `Services/RealtimeApi` |
| Gateway route docs must include both canonical friendship route and legacy `/friendships` route because both are present in Ocelot and frontend code uses the legacy route. | `Planora.ApiGateway/ocelot.json`, `frontend/src/hooks/use-friends.ts` |
