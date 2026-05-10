# Glossary

| Term | Meaning | Where used |
|---|---|---|
| Access token | Short-lived JWT used in `Authorization: Bearer` headers | `AuthenticationController.cs`, `frontend/src/store/auth.ts` |
| API Gateway | Ocelot ingress service that maps public routes to backend services | `Planora.ApiGateway` |
| Auth API | Service that owns identity, sessions, friendships, roles, analytics intake | `Services/AuthApi` |
| CSRF | Cross-site request forgery protection using double-submit cookie/header | `CsrfProtectionMiddleware.cs`, `frontend/src/lib/csrf.ts` |
| Category | User-owned label for todos with color/icon/order | `Services/CategoryApi` |
| Category gRPC | Internal service contract used to validate/enrich todo categories | `GrpcContracts/Protos/category.proto` |
| CQRS | Command/query separation through MediatR handlers | `*.Application/Features` |
| Friend request | Pending friendship relation between requester and addressee | `FriendshipsController.cs` |
| Friendship | Accepted social relation used for todo sharing | `Friendship.cs`, `auth.proto` |
| Hidden todo | Todo marked hidden globally for owner/private tasks or through viewer prefs for shared tasks | `TodoItem.Hidden`, `UserTodoViewPreference` |
| Hidden redaction | Server-side masking of hidden shared/public todo DTO fields | `HiddenTodoDtoFactory.cs` |
| Inbox | Integration event deduplication/receipt table pattern | `BuildingBlocks/.../Inbox` |
| JWT | JSON Web Token used as access token | `JwtAuthenticationExtensions.cs` |
| Ocelot | .NET API Gateway library used for route mapping | `Planora.ApiGateway/ocelot*.json` |
| Outbox | Integration event persistence pattern | `BuildingBlocks/.../Outbox` |
| PagedResult | Shared pagination response type | `BuildingBlocks/.../Pagination/PagedResult.cs` |
| Playwright e2e | Docker-backed test that exercises gateway/service auth, sharing, todo, and hidden flow | `frontend/e2e`, `.github/workflows/e2e.yml` |
| Production baseline | Documented deployment checklist and runtime assumptions, not an automated deploy target | `docs/production.md` |
| Refresh token | Long-lived server-side token delivered as httpOnly cookie | `RefreshToken.cs`, `AuthenticationController.cs` |
| Result | Shared success/failure return model | `BuildingBlocks/Planora.BuildingBlocks.Domain/Result.cs` |
| Schema bootstrap | Startup path that applies EF migrations when present or creates schema from the current EF model when migrations are absent | `DatabaseStartup.cs`, service `Program.cs` files |
| Secret store | Production location for sensitive values such as database passwords and JWT secret | `docs/secrets-management.md`, `.env.production.example` |
| SignalR | ASP.NET realtime transport used by Realtime API | `Services/RealtimeApi` |
| Todo share | Explicit row granting another user access to a todo | `TodoItemShare.cs` |
| Todo status | Backend task lifecycle enum: `Todo`, `InProgress`, `Done` | `Services/TodoApi/Planora.Todo.Domain/Enums` |
| UserTodoViewPreference | Per-viewer hidden/category state for a shared todo | `UserTodoViewPreference.cs` |
| XSRF-TOKEN | Readable CSRF cookie that frontend echoes in `X-CSRF-Token` | `AuthenticationController.GetCsrfToken` |
