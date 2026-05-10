# Database

Planora uses PostgreSQL with database-per-service ownership for Auth, Todo, Category, and Messaging. Realtime does not have an EF Core database context in the inspected code.

Infrastructure:

- `docker-compose.yml` starts `postgres:16-alpine`.
- host binding is `127.0.0.1:5433:5432`.
- services wait for PostgreSQL and initialize schema during startup.

## Database Ownership

| Service | DbContext | Connection string key | Database name |
|---|---|---|---|
| Auth | `AuthDbContext` | `AuthDatabase` | `planora_auth_db` |
| Todo | `TodoDbContext` | `TodoDatabase` | `planora_todo` |
| Category | `CategoryDbContext` | `CategoryDatabase` | `planora_category` |
| Messaging | `MessagingDbContext` | `MessagingDatabase` | `planora_messaging` |
| Realtime | none found | none found | not applicable |

Code:

- `Services/AuthApi/Planora.Auth.Infrastructure/Persistence/AuthDbContext.cs`
- `Services/TodoApi/Planora.Todo.Infrastructure/Persistence/TodoDbContext.cs`
- `Services/CategoryApi/Planora.Category.Infrastructure/Persistence/CategoryDbContext.cs`
- `Services/MessagingApi/Planora.Messaging.Infrastructure/Persistence/MessagingDbContext.cs`
- `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Persistence/DatabaseStartup.cs`
- service `Program.cs` files for database startup

## Startup And Schema Initialization

Auth, Todo, Category, and Messaging all:

1. wait for PostgreSQL with database creation support through `DependencyWaiter.WaitForPostgresWithDatabaseCreationAsync`;
2. call `DatabaseStartup.EnsureReadyAsync`;
3. if EF migrations exist in the service assembly, apply pending migrations with retry;
4. if no EF migrations exist, create the schema from the current EF model through `EnsureCreatedAsync`;
5. fail startup after retry exhaustion.

The repository intentionally ignores `**/Migrations/**`. This keeps generated EF migrations user-owned for local forks/installations. A clean Docker/local install still starts because `EnsureCreatedAsync` can create the current schema when no migrations are present.

Operational caveat: `EnsureCreatedAsync` is suitable for first-run local/bootstrap installs without committed migrations. For production environments that require auditable schema evolution, generate service-owned migrations before deployment and let `DatabaseStartup.EnsureReadyAsync` use the normal `MigrateAsync` path.

Do not mix both paths on the same persistent database without planning. If a database was created by `EnsureCreatedAsync` and you later decide to use EF migrations for that same database, recreate the local database/volume or create a proper baseline migration strategy first.

Code:

- `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Resilience/DependencyWaiter.cs`
- `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Persistence/DatabaseStartup.cs`
- `Services/*/Planora.*.Api/Program.cs`

## Auth Database

DbContext: `Services/AuthApi/Planora.Auth.Infrastructure/Persistence/AuthDbContext.cs`

### Tables / DbSets

| DbSet | Purpose |
|---|---|
| `Users` | account identity, profile, status, email verification, password reset, 2FA, lockout, soft delete |
| `Roles` | role catalog |
| `UserRoles` | user-role join |
| `RefreshTokens` | server-side refresh token records and device/session metadata |
| `LoginHistory` | login attempts and audit history |
| `Friendships` | requester/addressee friendship state |
| `AuditLogs` | auth audit trail |
| `PasswordHistory` | previous password hashes for reuse checks |
| `InboxMessages` | integration inbox |
| `OutboxMessages` | integration outbox |

### Important Configuration

| Entity | Important fields/indexes | Code |
|---|---|---|
| `User` | email owned value max 255 and unique; first/last name max 100; password hash max 500; email verification and password reset token fields; soft delete filter/indexes | `Persistence/Configurations/UserConfiguration.cs` |
| `Role` | unique role name, seeded roles `Admin` and `User` | `Persistence/Configurations/RoleConfiguration.cs` |
| `UserRole` | composite uniqueness on `(UserId, RoleId)` | `Persistence/Configurations/UserRoleConfiguration.cs` |
| `RefreshToken` | token unique max 500; indexes by user/expiry/revocation/delete; `RememberMe`; device fingerprint/name; partial unique non-revoked device index filtered on `RevokedAt IS NULL` | `Persistence/Configurations/RefreshTokenConfiguration.cs` |
| `Friendship` | requester/addressee/status/date fields; indexes for both sides and status | `Persistence/Configurations/FriendshipConfiguration.cs` |
| `LoginHistory` | IP/user agent/failure reason, indexes by user/login/success/delete | `Persistence/Configurations/LoginHistoryConfiguration.cs` |
| `PasswordHistory` | user id, password hash max 500, changed date | `Persistence/Configurations/PasswordHistoryConfiguration.cs` |

### Auth Schema Bootstrap

Committed migrations are not stored in the repository. Auth schema is derived from `AuthDbContext` plus configuration classes under `Services/AuthApi/Planora.Auth.Infrastructure/Persistence/Configurations`.

Runtime startup applies user-created migrations if they exist; otherwise it creates the schema from the current model.

PostgreSQL requires partial index predicates to be immutable. Auth refresh-token uniqueness therefore does not use `NOW()` in the database filter; expiry remains part of token lifecycle logic while the database enforces uniqueness for non-revoked user/device token rows.

## Todo Database

DbContext: `Services/TodoApi/Planora.Todo.Infrastructure/Persistence/TodoDbContext.cs`

Default schema: `todo`

### Tables / DbSets

| DbSet/table | Purpose |
|---|---|
| `TodoItems` | task core data |
| `todo_tags` | owned collection for todo tags |
| `todo_item_shares` | explicit shared-with users |
| `todo_item_workers` | non-owner participants (workers) on public/shared tasks |
| `todo_item_comments` | comment thread on public/shared tasks; soft-deletable |
| `user_todo_view_preferences` | viewer-specific hidden/category preferences |

### Important Configuration

| Entity | Important fields/indexes | Code |
|---|---|---|
| `TodoItem` | title max 200; description max 2000; status stored as string; priority stored as int; user/category ids; `IsPublic`; `Hidden`; `RequiredWorkers` (nullable int, total headcount including owner); soft delete; indexes by user/category/status/delete/created | `Persistence/Configurations/TodoItemConfiguration.cs` |
| `TodoTag` | owned table `todo_tags`, tag name max 50 | `TodoItemConfiguration.cs` |
| `TodoItemShare` | table `todo_item_shares`, composite key `(TodoItemId, SharedWithUserId)`, index by shared user | `Persistence/Configurations/TodoItemShareConfiguration.cs` |
| `TodoItemWorker` | table `todo_item_workers`, composite PK `(TodoItemId, UserId)`, `JoinedAt` default `now()`, cascade FK to `TodoItems`; indexes on `UserId` and `TodoItemId` | `Persistence/Configurations/TodoItemWorkerConfiguration.cs` |
| `TodoItemComment` | table `todo_item_comments`, PK `Id`, `AuthorId`, `AuthorName` max 200, `Content` max 2000, soft delete, cascade FK to `TodoItems`; composite index `(TodoItemId, CreatedAt)` | `Persistence/Configurations/TodoItemCommentConfiguration.cs` |
| `UserTodoViewPreference` | table `todo.user_todo_view_preferences`, composite key `(ViewerId, TodoItemId)`, `HiddenByViewer`, optional `ViewerCategoryId`, index `(TodoItemId, ViewerId)` | `Persistence/Configurations/UserTodoViewPreferenceConfiguration.cs` |

### Worker Capacity Semantics

`RequiredWorkers` = total headcount including the owner. A task with `RequiredWorkers = 2` allows one non-owner worker slot. The owner is **never** stored in `todo_item_workers`; they implicitly always participate. Capacity is full when `Workers.Count >= RequiredWorkers - 1`.

When access changes (task made private, `SharedWith` list shrunk, or capacity reduced), workers who lose access are evicted automatically inside the domain model. Eviction on capacity reduction uses LIFO order (most-recently-joined workers are removed first).

### Todo Schema Bootstrap

A committed EF migration `AddWorkersAndComments` (generated 2026-05-10) is stored at `Services/TodoApi/Planora.Todo.Infrastructure/Migrations/`. Runtime startup applies it automatically via `DatabaseStartup.EnsureReadyAsync`.

To apply manually:

```powershell
dotnet ef database update `
  --project Services/TodoApi/Planora.Todo.Infrastructure `
  --startup-project Services/TodoApi/Planora.Todo.Api
```

### Important Caveat

`CreateTodoCommandValidator` and `UpdateTodoCommandValidator` allow description max length 5000, but `TodoItemConfiguration` configures the persisted column max length as 2000. Treat 2000 as the safe limit until the code is reconciled.

## Category Database

DbContext: `Services/CategoryApi/Planora.Category.Infrastructure/Persistence/CategoryDbContext.cs`

### Tables / DbSets

| DbSet | Purpose |
|---|---|
| `Categories` | user-owned category definitions |
| `OutboxMessages` | integration outbox |

### Important Configuration

| Entity | Important fields/indexes | Code |
|---|---|---|
| `Category` | name required max 50; description max 500; color required max 7 default `#007BFF`; optional icon; user id; order default 0; soft delete; indexes by user/delete/created | `Persistence/Configurations/CategoryConfiguration.cs` |

Color validation is in `Services/CategoryApi/Planora.Category.Domain/Enums/CategoryColors.cs`.

Committed migrations are not stored in the repository. Category schema is derived from `CategoryDbContext` plus configuration classes under `Services/CategoryApi/Planora.Category.Infrastructure/Persistence/Configurations`.

Runtime startup applies user-created migrations if they exist; otherwise it creates the schema from the current model.

## Messaging Database

DbContext: `Services/MessagingApi/Planora.Messaging.Infrastructure/Persistence/MessagingDbContext.cs`

### Tables / DbSets

| DbSet | Purpose |
|---|---|
| `Messages` | direct messages |
| `OutboxMessages` | integration outbox |
| `InboxMessages` | integration inbox |

### Important Configuration

`MessagingDbContext` configures `Message` inline:

| Field/index | Rule |
|---|---|
| `Id` | value generated never |
| `Subject` | required, max 200 |
| `Body` | required |
| `SenderId`, `RecipientId` | required |
| `ReadAt` | optional |
| `IsArchived` | default false |
| indexes | `SenderId`, `RecipientId`, `(RecipientId, ReadAt)`, `(SenderId, RecipientId, CreatedAt)`, `CreatedAt` |

Committed migrations are not stored in the repository. Messaging schema is derived from `MessagingDbContext`, which configures `Message` inline.

Runtime startup applies user-created migrations if they exist; otherwise it creates the schema from the current model.

## Realtime Persistence

No EF Core `DbContext`, migration folder, or database connection string was found for Realtime. Realtime connection state and notification delivery are implemented through service abstractions, SignalR, Redis backplane, and RabbitMQ subscriptions.

Code:

- `Services/RealtimeApi/Planora.Realtime.Api/Program.cs`
- `Services/RealtimeApi/Planora.Realtime.Infrastructure`

## Outbox / Inbox Pattern

Outbox and inbox primitives exist in shared infrastructure:

- `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Outbox`
- `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Inbox`

Auth, Category, and Messaging explicitly expose outbox/inbox DbSets where needed. Todo consumes integration events for category and user deletion.

## Safe Database Operations

For local development:

- prefer launch scripts or Docker Compose over manual database bootstrapping;
- do not delete Docker volumes unless intentionally wiping local data;
- use `dotnet ef` only after verifying the target service project and startup project;
- keep migrations service-owned and do not let one service mutate another service's schema;
- keep generated `Migrations/` folders local unless project policy changes.

Example local migration commands:

```powershell
dotnet ef migrations add InitialLocal `
  --project Services/AuthApi/Planora.Auth.Infrastructure `
  --startup-project Services/AuthApi/Planora.Auth.Api
```

## Example Inspection Commands

```powershell
docker compose ps postgres
docker exec -it planora-postgres psql -U postgres -l
```

Service-specific database names:

```text
planora_auth_db
planora_todo
planora_category
planora_messaging
```
