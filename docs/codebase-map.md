# Codebase Map

This map is organized by ownership boundary. It intentionally avoids generated artifacts such as `bin/`, `obj/`, `.next/`, `node_modules/`, logs, caches, and test results.

## Root

| Path | Purpose | Key files |
|---|---|---|
| `README.md` | project entry point | links to docs and quick start |
| `.env.example` | local environment template | required Docker secrets and local defaults |
| `.env.production.example` | production key template | secret/config checklist for deployment platforms |
| `docker-compose.yml` | local infrastructure and backend containers | service ports, env injection, health checks |
| `Planora.sln` | backend solution | includes services and tests |
| `Directory.Build.props` | shared .NET project defaults | `net9.0`, nullable, warnings as errors |
| `Directory.Packages.props` | central NuGet versions | ASP.NET Core, EF Core, MediatR, Ocelot, Serilog, test packages |
| `coverage.runsettings` | .NET coverage configuration | excludes generated/migration/program files |
| `Start-Planora-Docker.ps1` | Docker backend launcher | preflight, Compose, frontend |
| `Start-Planora-Local.ps1` | local backend launcher | infra containers, local `dotnet run`, frontend |
| `.github/workflows` | CI/security/e2e automation | `ci.yml`, `e2e.yml`, `security.yml` |
| `graphify-out` | generated knowledge graph | `GRAPH_REPORT.md`, `wiki/index.md`, `graph.json` |

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
| `Services/AuthApi/Planora.Auth.Infrastructure` | EF Core context/configurations/repositories, token/password/email services, event handlers |

Key controller files:

- `Controllers/AuthenticationController.cs`
- `Controllers/UsersController.cs`
- `Controllers/FriendshipsController.cs`
- `Controllers/AnalyticsController.cs`

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
| `Services/TodoApi/Planora.Todo.Domain` | todo item, share, viewer preference, enums, value objects |
| `Services/TodoApi/Planora.Todo.Infrastructure` | EF Core context/configurations/repositories, category/auth clients |

Critical files:

- `Controllers/TodosController.cs`
- `Features/Todos/Queries/GetUserTodos/GetUserTodosQueryHandler.cs`
- `Features/Todos/Queries/GetTodoById/GetTodoByIdQueryHandler.cs`
- `Features/Todos/Queries/GetComments/GetCommentsQueryHandler.cs`
- `Features/Todos/Commands/CreateTodo/CreateTodoCommandHandler.cs`
- `Features/Todos/Commands/UpdateTodo/UpdateTodoCommandHandler.cs`
- `Features/Todos/Commands/JoinTodo/JoinTodoCommandHandler.cs`
- `Features/Todos/Commands/LeaveTodo/LeaveTodoCommandHandler.cs`
- `Features/Todos/Commands/AddComment/AddCommentCommandHandler.cs`
- `Features/Todos/Commands/UpdateComment/UpdateCommentCommandHandler.cs`
- `Features/Todos/Commands/DeleteComment/DeleteCommentCommandHandler.cs`
- `Features/Todos/Commands/SetTodoHidden/SetTodoHiddenCommandHandler.cs`
- `Features/Todos/Commands/SetViewerPreference/SetViewerPreferenceCommandHandler.cs`
- `Features/Todos/TodoViewerStateResolver.cs`
- `Features/Todos/HiddenTodoDtoFactory.cs`
- `Domain/Entities/TodoItem.cs` — aggregate root with `Workers`, `RequiredWorkers`, `IsCapacityFull`
- `Domain/Entities/TodoItemWorker.cs`
- `Domain/Entities/TodoItemComment.cs`
- `Domain/Repositories/ITodoCommentRepository.cs`
- `Persistence/TodoDbContext.cs`
- `Persistence/Repositories/TodoCommentRepository.cs`
- `Persistence/Configurations/TodoItemWorkerConfiguration.cs`
- `Persistence/Configurations/TodoItemCommentConfiguration.cs`

## Category Service

| Path | Purpose |
|---|---|
| `Services/CategoryApi/Planora.Category.Api` | category HTTP controller, gRPC service, startup |
| `Services/CategoryApi/Planora.Category.Application` | category commands/queries/validators/mappings |
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
| `Services/MessagingApi/Planora.Messaging.Infrastructure` | EF Core context/repositories/event handlers |

Critical files:

- `Controllers/MessagesController.cs`
- `Features/Messages/Commands/SendMessage`
- `Features/Messages/Queries/GetMessages`
- `Infrastructure/Persistence/MessagingDbContext.cs`

## Realtime Service

| Path | Purpose |
|---|---|
| `Services/RealtimeApi/Planora.Realtime.Api` | controllers, SignalR hub mapping, realtime gRPC service, startup |
| `Services/RealtimeApi/Planora.Realtime.Application` | notification request/response contracts and handlers |
| `Services/RealtimeApi/Planora.Realtime.Infrastructure` | SignalR/connection manager/notification infrastructure |

Critical files:

- `Controllers/ConnectionsController.cs`
- `Controllers/NotificationsController.cs`
- `Hubs/PresenceHub.cs`
- `Infrastructure/Hubs/NotificationHub.cs`
- `Program.cs`

No Realtime EF Core `DbContext` was found.

## gRPC Contracts

| Path | Purpose |
|---|---|
| `GrpcContracts/Protos/auth.proto` | Auth service contract: token/user/friend checks |
| `GrpcContracts/Protos/category.proto` | Category contract used by Todo |
| `GrpcContracts/Protos/todo.proto` | Todo contract |
| `GrpcContracts/Protos/messaging.proto` | Messaging contract |
| `GrpcContracts/Protos/realtime.proto` | Realtime notification contract |

## Frontend

| Path | Purpose |
|---|---|
| `frontend/src/app` | Next.js App Router pages |
| `frontend/src/components` | UI and domain components |
| `frontend/src/lib` | API client, auth public client, CSRF, config, analytics, utilities |
| `frontend/src/store` | Zustand state |
| `frontend/src/types` | frontend DTO/type helpers |
| `frontend/src/utils` | sorting/category filter helpers |
| `frontend/src/test` | Vitest tests |
| `frontend/e2e` | Playwright e2e tests against the API Gateway |
| `frontend/next.config.js` | Next.js config and security headers |
| `frontend/playwright.config.ts` | Playwright e2e config |
| `frontend/vitest.config.ts` | Vitest config |

Important routes:

- `frontend/src/app/page.tsx`
- `frontend/src/app/dashboard/page.tsx`
- `frontend/src/app/todos/page.tsx`
- `frontend/src/app/todos/completed/page.tsx`
- `frontend/src/app/categories/page.tsx`
- `frontend/src/app/profile/page.tsx`
- `frontend/src/app/auth/*/page.tsx`

## Tests

| Path | Purpose |
|---|---|
| `tests/Planora.UnitTests` | unit and contract tests for building blocks and services |
| `tests/Planora.ErrorHandlingTests` | middleware/error-handling and integration-style checks |
| `frontend/src/test` | frontend component/lib/store/type tests with Vitest |
| `frontend/e2e` | Docker-backed Playwright auth/todos/sharing/hidden flow |

## Documentation

| Path | Purpose |
|---|---|
| `docs/index.md` | documentation navigation |
| `docs/DECISIONS` | architecture decision records |
| `docs/production.md`, `docs/secrets-management.md` | production and secret-management baseline |
| `ARCHITECTURE.md`, `SECURITY.md`, `TESTING.md`, `CONTRIBUTING.md` | root-level summaries and contributor-facing docs |
| `LICENSE` | MIT license |
