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
| Collaboration | `CollaborationDbContext` | `CollaborationDatabase` | `planora_collaboration` |
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

## Migration Governance

For production rollouts the project ships a dedicated, standalone migration runner — [`tools/Planora.Migrator/`](../tools/Planora.Migrator/) — that replaces the implicit "every service applies pending migrations at startup" pattern, which is unsafe under HA (two replicas racing the same migration can corrupt `__EFMigrationsHistory`).

| Concern | How it is handled |
|---|---|
| Pre-deploy migration | `dotnet Planora.Migrator.dll --all` (or `--service <name>` for a single service). On Fly.io: `flyctl machine run --rm planora-migrator -- --all`. |
| Review-time visibility | `.github/workflows/migrations.yml` runs `dotnet ef migrations script --idempotent` for each of the four DB-owning services on every PR whose schema-relevant paths change, and attaches the `.sql` files as 30-day-retention artifacts. |
| Idempotence | The generated scripts wrap every statement in a `__EFMigrationsHistory` lookup so re-running them on an up-to-date schema is a no-op. |
| Connection-string priority | The CLI reads `ConnectionStrings__<Name>` from env vars / `appsettings.json` first; `--connection-string` overrides everything. |
| Failure semantics | The CLI returns `0` on success, `64` on bad args, `70` if any one service migration failed. |
| Auth / Category DbContexts | Both require an `IDomainEventDispatcher` for their constructors; the migrator injects a `NoOpDomainEventDispatcher` because migrations never raise domain events. |

This convention is locked in by [`docs/INVARIANTS.md`](INVARIANTS.md) `INV-FLOW-4`. Until the CD pipeline lands and invokes the migrator pre-deploy, services continue to auto-migrate at startup as described in the previous section. The cutover is a single change in the CD workflow plus disabling startup migration in each service.

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
| `UserRecoveryCodes` | single-use 2FA recovery codes (BCrypt-hashed) |
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
| `UserRecoveryCodes` | user id (FK), BCrypt code hash max 500, `IsUsed` flag, `UsedAt` nullable; composite index on `(UserId, IsUsed)` | `Persistence/Configurations/UserRecoveryCodeConfiguration.cs` |

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
| `user_todo_view_preferences` | viewer-specific hidden/category preferences |
| `OutboxMessages` | task-lifecycle integration events shipped to RabbitMQ (drives the Collaboration timeline) |

> The comment thread ("ветки") no longer lives in the Todo database. It moved to the
> **Collaboration** service (`planora_collaboration.collaboration.comments`). Todo only
> publishes task-lifecycle facts (`TaskCreated` / `TaskActivity` / `TaskDeleted`) via its
> outbox; Collaboration consumes them and materialises system/genesis comments. See the
> **Collaboration Database** section below.

### Important Configuration

| Entity | Important fields/indexes | Code |
|---|---|---|
| `TodoItem` | title max 1500 (a subtask's content lives in its title; regular-task titles stay ≤200 via the create validator + UI); description max 2000; status stored as string; priority stored as int; user/category ids; `IsPublic`; `Hidden`; `RequiredWorkers` (nullable int, total headcount including owner); soft delete; indexes by user/category/status/delete/created. On existing migration-built DBs the `Title` column is widened to `varchar(1500)` at TodoApi startup (idempotent, metadata-only) so it matches the EF model | `Persistence/Configurations/TodoItemConfiguration.cs` |
| `TodoTag` | owned table `todo_tags`, tag name max 50 | `TodoItemConfiguration.cs` |
| `TodoItemShare` | table `todo_item_shares`, composite key `(TodoItemId, SharedWithUserId)`, index by shared user | `Persistence/Configurations/TodoItemShareConfiguration.cs` |
| `TodoItemWorker` | table `todo_item_workers`, composite PK `(TodoItemId, UserId)`, `JoinedAt` default `now()`, cascade FK to `TodoItems`; indexes on `UserId` and `TodoItemId` | `Persistence/Configurations/TodoItemWorkerConfiguration.cs` |
| `UserTodoViewPreference` | table `todo.user_todo_view_preferences`, composite key `(ViewerId, TodoItemId)`, `HiddenByViewer`, `CompletedByViewer` bool, `CompletedByViewerAt` nullable datetime, optional `ViewerCategoryId`, index `(TodoItemId, ViewerId)` | `Persistence/Configurations/UserTodoViewPreferenceConfiguration.cs` |
| `OutboxMessage` | table `todo.OutboxMessages`, status stored as string, indexes `(Status, OccurredOnUtc)` and `ProcessedOnUtc`; shipped by the shared `OutboxProcessor` | `Persistence/Configurations/OutboxMessageConfiguration.cs` |

### Worker Capacity Semantics

`RequiredWorkers` = total headcount including the owner. A task with `RequiredWorkers = 2` allows one non-owner worker slot. The owner is **never** stored in `todo_item_workers`; they implicitly always participate. Capacity is full when `Workers.Count >= RequiredWorkers - 1`.

When access changes (task made private, `SharedWith` list shrunk, or capacity reduced), workers who lose access are evicted automatically inside the domain model. Eviction on capacity reduction uses LIFO order (most-recently-joined workers are removed first).

### Todo Schema Bootstrap

The repository `.gitignore` lists `**/Migrations/**`, so migrations are **force-added**
(`git add -f`) when they must ship a schema change for review and CD. Runtime startup applies
pending migrations automatically via `DatabaseStartup.EnsureReadyAsync`. Current committed migrations:

| Migration name | Date | Change |
|---|---|---|
| `AddWorkersAndComments` | 2026-05-10 | Adds `todo_item_workers`, `todo_item_comments`, and related FK/indexes |
| `AddSystemComment` | 2026-05-17 | Adds `is_system_comment bool NOT NULL DEFAULT false` to `todo_item_comments`; adds `completed_by_viewer` and `completed_by_viewer_at` to `user_todo_view_preferences` |
| `AddGenesisComment` | 2026-05-18 | Adds `is_genesis_comment bool NOT NULL DEFAULT false` to `todo_item_comments` |
| `AddCommentAvatarUrl` | 2026-05-25 | Adds `AuthorAvatarUrl varchar(2048) NULL` to `todo_item_comments`; adds `xmin` row-version column to `TodoItems` for EF Core optimistic concurrency |
| `RemoveCommentAvatarSnapshot` | 2026-05-26 | Drops `AuthorAvatarUrl` from `todo_item_comments`. Comment listing now always batch-fetches the live avatar from Auth via gRPC, cached in-memory 60 s. Single source of truth eliminates stale-avatar drift after the user changes their picture. |
| `RemoveCommentsAddOutbox` | 2026-05-29 | **Drops `todo_item_comments`** (the timeline moved to the Collaboration service) and creates `todo.OutboxMessages` so Todo can publish task-lifecycle integration events. Run the Collaboration backfill (`Planora.Migrator --backfill-collaboration`) **before** this migration is applied in production so no comment is lost. |

To apply manually:

```powershell
dotnet ef database update `
  --project Services/TodoApi/Planora.Todo.Infrastructure `
  --startup-project Services/TodoApi/Planora.Todo.Api
```

### Description length

`CreateTodoCommandValidator`, `UpdateTodoCommandValidator`, and the `TodoItemConfiguration`
`Description` column all agree on a 2000-character maximum.

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

## Collaboration Database

DbContext: `Services/CollaborationApi/Planora.Collaboration.Infrastructure/Persistence/CollaborationDbContext.cs`

Default schema: `collaboration`

Owns the task **comment timeline** ("ветки") — regular user comments and auto-generated system
comments (created / completed / started / left). The pinned "Author's Note" (the task description)
is **not** stored here: it is the single source of truth on the task (Todo) and is synthesised on
read from `TodoService.CheckTaskCommentAccess` (which now also returns the live `description` +
`taskCreatedAt`). The service never reads the Todo database (INV-OWN-1) and resolves author identity
(name + avatar) live through Auth's `GetUserProfilesBatch` gRPC (60 s in-memory cache via
`CachingUserService`) — no stored copy of the name.

### Tables / DbSets

| DbSet/table | Purpose |
|---|---|
| `comments` | timeline: user + system comments, soft-deletable (the Author's Note/description is synthesised on read, not stored; legacy genesis rows, if any, are excluded by the read query) |
| `OutboxMessages` | `NotificationEvent` fan-out to RabbitMQ (consumed by Realtime → SignalR) |
| `InboxMessages` | consumer idempotency: PK = integration event id. The event bus skips a handler when the event id already exists (dedup of redelivered/replayed events — INV-COMM-4) |

### Important Configuration

| Entity | Important fields/indexes | Code |
|---|---|---|
| `Comment` | PK `Id`, `TaskId` (value link to the Todo task — no FK, INV-OWN-1), `AuthorId`, `AuthorName` max 200 (fallback only — identity resolved live), `Content` max 5000, `IsSystemComment`/`IsGenesisComment` bool (default false; new rows never set genesis — kept only so legacy genesis rows are filtered out on read), soft delete, `xmin` optimistic concurrency; indexes `(TaskId, CreatedAt)` for timeline reads and `AuthorId` for the user-deletion cascade / moderation scans | `Persistence/Configurations/CommentConfiguration.cs` |
| `OutboxMessage` | table `collaboration.OutboxMessages`, status stored as string, indexes `(Status, OccurredOnUtc)` and `ProcessedOnUtc` | `Persistence/Configurations/OutboxMessageConfiguration.cs` |

### Event Flow

- **Inbound (Inbox):** subscribes to `TaskCreatedIntegrationEvent`, `TaskActivityIntegrationEvent`,
  `TaskDeletedIntegrationEvent`, `SubtaskDeletedIntegrationEvent` (from Todo) and `UserDeletedIntegrationEvent` (from Auth). Replay-safe
  (INV-COMM-4): the event bus dedups on the integration event id via the `InboxMessages` table —
  a redelivered event is skipped before its handler runs, so system comments are never duplicated.
- **Outbound (Outbox):** `AddComment` writes a `NotificationEvent` per participant
  (owner + workers + shared-with, minus the author) so RealtimeApi can push a SignalR notification.

### Collaboration Schema Bootstrap

No committed EF migration: like Category, the schema is created on first run via
`DatabaseStartup.EnsureReadyAsync` → `EnsureCreatedAsync`. The database `planora_collaboration`
is auto-created at startup by `DependencyWaiter.WaitForPostgresWithDatabaseCreationAsync`.

### Data Migration From Todo

When extracting from an existing deployment, run the idempotent backfill **before** dropping the
old table:

```bash
dotnet run --project tools/Planora.Migrator -- --backfill-collaboration
```

It copies `planora_todo.todo.todo_item_comments` → `planora_collaboration.collaboration.comments`
with `INSERT ... ON CONFLICT (Id) DO NOTHING`, so it is safe to run twice (once ahead of time, once
at cutover to capture the window).

## Realtime Persistence

No EF Core `DbContext`, migration folder, or database connection string was found for Realtime. Realtime connection state and notification delivery are implemented through service abstractions, SignalR, Redis backplane, and RabbitMQ subscriptions.

Code:

- `Services/RealtimeApi/Planora.Realtime.Api/Program.cs`
- `Services/RealtimeApi/Planora.Realtime.Infrastructure`

## Outbox / Inbox Pattern

Outbox and inbox primitives exist in shared infrastructure:

- `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Outbox`
- `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Inbox`

Auth, Category, Messaging, Todo, and Collaboration explicitly expose outbox/inbox DbSets where needed. Todo consumes integration events for category and user deletion, and publishes task-lifecycle events via its outbox. Collaboration consumes those task-lifecycle events plus user deletion, and publishes comment `NotificationEvent`s via its outbox.

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
