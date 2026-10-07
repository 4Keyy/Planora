# Database

Planora uses PostgreSQL with database-per-service ownership for Auth, Todo, Category, Messaging, Collaboration, and Realtime (Realtime persists the durable notification log).

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
| Realtime | `RealtimeDbContext` | `RealtimeDatabase` | `planora_realtime` |

Code:

- `Services/AuthApi/Planora.Auth.Infrastructure/Persistence/AuthDbContext.cs`
- `Services/TodoApi/Planora.Todo.Infrastructure/Persistence/TodoDbContext.cs`
- `Services/CategoryApi/Planora.Category.Infrastructure/Persistence/CategoryDbContext.cs`
- `Services/MessagingApi/Planora.Messaging.Infrastructure/Persistence/MessagingDbContext.cs`
- `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Persistence/DatabaseStartup.cs`
- service `Program.cs` files for database startup

## Startup And Schema Initialization

Auth, Todo, Category, Messaging and Collaboration initialize their database during startup.
Realtime does so when `ConnectionStrings__RealtimeDatabase` is configured. The common path:

1. wait for PostgreSQL with database creation support through `DependencyWaiter.WaitForPostgresWithDatabaseCreationAsync`;
2. call `DatabaseStartup.EnsureReadyAsync`;
3. if EF migrations exist in the service assembly, apply pending migrations with retry;
4. if no EF migrations exist, create the schema from the current EF model through `EnsureCreatedAsync`;
5. fail startup after retry exhaustion.

The repository ignores newly generated `**/Migrations/**`, but already-tracked migrations
remain tracked: Todo has three incremental migrations and Realtime has one initial migration.
Auth, Category, Messaging and Collaboration have no tracked migrations. Do not assume all
services take the `EnsureCreatedAsync` branch.

**Clean Todo bootstrap is currently incomplete.** Its earliest tracked migration,
`20260511105105_AddViewerCompletion`, alters an existing `todo.user_todo_view_preferences`
table; the migration that creates the base schema is absent. Since migrations exist,
`DatabaseStartup` selects `MigrateAsync`, so an empty Todo database cannot be initialized
from this migration chain. An existing compatible database or a reviewed baseline migration
is required. Startup DDL runs after migration and does not repair this missing baseline.

`EnsureCreatedAsync` creates an absent schema; it never upgrades an existing schema.
Production schema evolution requires a reviewed, service-owned migration chain. Startup
schema mutation is currently enabled in Production too; no environment gate disables it.

Do not mix both paths on the same persistent database without planning. If a database was created by `EnsureCreatedAsync` and you later decide to use EF migrations for that same database, recreate the local database/volume or create a proper baseline migration strategy first.

Code:

- `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Resilience/DependencyWaiter.cs`
- `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Persistence/DatabaseStartup.cs`
- `Services/*/Planora.*.Api/Program.cs`

## Migration Governance

The standalone migration runner — [`tools/Planora.Migrator/`](../tools/Planora.Migrator/) —
supports `auth`, `category`, `todo`, `messaging`, `realtime` and `collaboration`. The CD workflow
attempts a pre-deploy migration, but the runner does not disable service startup migrations.
Migration history, container build inputs and connection strings must be reconciled before
treating this as a working deployment path; see [production.md](production.md).

| Concern | How it is handled |
|---|---|
| Pre-deploy migration | `dotnet Planora.Migrator.dll --all` (or `--service <name>` for a single service). On Fly.io: `flyctl machine run --rm planora-migrator -- --all`. |
| Review-time visibility | `.github/workflows/migrations.yml` defines SQL-script artifacts for Auth, Category, Todo, Messaging and Collaboration; Realtime is omitted. Its current EF tool/build setup requires correction before the job can be relied on. |
| Idempotence | The generated scripts wrap every statement in a `__EFMigrationsHistory` lookup so re-running them on an up-to-date schema is a no-op. |
| Connection-string priority | The CLI reads `ConnectionStrings__<Name>` from env vars / `appsettings.json` first; `--connection-string` overrides everything. |
| Failure semantics | The CLI returns `0` on success, `64` on bad args, `70` if any one service migration failed. |
| Dispatcher-dependent contexts | Auth, Category and Realtime require `IDomainEventDispatcher`; the runner injects a no-op dispatcher for schema operations. |
| Schema drift | Applied migration IDs absent from the compiled migration set cause a failure; the CLI does not silently migrate an unknown history. |
| No migrations | The CLI reports no pending migrations and returns successfully; it does not invoke `EnsureCreatedAsync` to bootstrap these services. |

The committed CD workflow exists, while rollout readiness remains limited by its build and
schema prerequisites. `INV-FLOW-4` in [INVARIANTS.md](INVARIANTS.md) records the migration
policy and its current enforcement gaps. A startup migration succeeding on one developer's
database is not evidence that an empty database or multiple replicas can start safely.

## Auth Database

Unless explicitly listed as a composite key, entity and message tables use `Id uuid NOT NULL`
as the primary key. `BaseEntity` also contributes `CreatedAt` (required), nullable
`CreatedBy`/`UpdatedAt`/`UpdatedBy`/`DeletedAt`/`DeletedBy`, and required `IsDeleted`.
Domain construction sets identity and creation time; do not assume these are database
`DEFAULT` expressions. `?` below means nullable. Cross-service UUIDs are value references,
not foreign keys to another database. EF convention mappings remain part of the model even
when a property has no explicit configuration statement.

DbContext: `Services/AuthApi/Planora.Auth.Infrastructure/Persistence/AuthDbContext.cs`

### Tables / DbSets

| DbSet / table | Purpose | Key and important constraints |
|---|---|---|
| `Users` | Identity, profile, status, verification, reset, 2FA, lockout | PK `Id`; unique required `Email varchar(255)`; required first/last name ≤100 and password hash ≤500; verification/reset hashes ≤500 nullable; TOTP ciphertext ≤1024 nullable; soft-delete query filter. |
| `Roles` | Role catalog | PK `Id`; unique required `Name varchar(100)`, nullable description ≤500; cascade role→user-role join; seeded Admin/User; soft-delete filter. |
| `UserRoles` | User-role join | PK `Id` (not a composite PK); unique `(UserId, RoleId)`; both required UUID FKs with cascade deletion; query excludes deleted join/user/role. |
| `RefreshTokens` | Session records | PK `Id`; unique required `Token varchar(500)` stores SHA-256 hash; required user FK, expiry/IP; nullable device fingerprint ≤64/name ≤255 and revocation fields; `RememberMe=false`, `LoginCount=1`, `LastLoginAt=NOW()` defaults; partial unique `(UserId, DeviceFingerprint)` where `RevokedAt IS NULL`. |
| `LoginHistory` | Login attempts | PK `Id`; required user FK, IP ≤50, user agent ≤500, attempt time/success; nullable failure reason ≤500; query excludes deleted history/users. |
| `Friendships` | Requester/addressee state | PK `Id`; two required user FKs with `Restrict`; required string status, nullable requested/accepted/rejected dates; requester/addressee pair indexes are **not unique**; `xmin` concurrency; query excludes deleted rows and deleted endpoints. |
| `AuditLogs` | Auth audit trail | PK `Id`; required `Action` ≤50, `EntityName` ≤100 and `EntityId`; old/new values, details, IP and severity nullable; no global soft-delete filter. |
| `PasswordHistory` | Previous password hashes | PK `Id`; required `UserId`, password hash ≤500 and changed time; no configured user FK or global query filter. |
| `UserRecoveryCodes` | Single-use 2FA recovery codes | PK `Id`; required `UserId`, PBKDF2 `CodeHash` ≤500, `IsUsed`; nullable `UsedAt`; `(UserId, IsUsed)` index; no configured user FK or global query filter. |
| `InboxMessages` | Inbox primitives; no active Auth subscriber | PK `Id`; unique required `MessageId` ≤255, required type ≤255/content/received date/string status; nullable processed date/error ≤2000. |
| `OutboxMessages` | Integration outbox | PK `Id`; shared outbox contract below; active partial polling index. |

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
| `UserRecoveryCodes` | user id value reference (no configured FK), PBKDF2 code hash max 500, `IsUsed` flag, `UsedAt` nullable; composite index on `(UserId, IsUsed)` | `Persistence/Configurations/UserRecoveryCodeConfiguration.cs` |

### Auth Schema Bootstrap

Committed migrations are not stored in the repository. Auth schema is derived from `AuthDbContext` plus configuration classes under `Services/AuthApi/Planora.Auth.Infrastructure/Persistence/Configurations`.

Runtime startup applies user-created migrations if they exist; otherwise it creates the schema from the current model.

PostgreSQL requires partial index predicates to be immutable. Auth refresh-token uniqueness therefore does not use `NOW()` in the database filter; expiry remains part of token lifecycle logic while the database enforces uniqueness for non-revoked user/device token rows.

## Todo Database

DbContext: `Services/TodoApi/Planora.Todo.Infrastructure/Persistence/TodoDbContext.cs`

Default schema: `todo`

### Tables / DbSets

| DbSet/table | Purpose | Key and important constraints |
|---|---|---|
| `TodoItems` | Task and subtask aggregates | PK `Id`; required title ≤1500/owner UUID; nullable description ≤2000/category/creator/parent/dates/capacity; `ParentTodoId` self-FK with `NoAction`; string status default Todo, integer priority default Medium; public/hidden/deleted default false; `xmin` concurrency; no global query filter (repositories filter explicitly). |
| `todo_tags` | Owned labels | PK `Id`; required name ≤50; owner FK `TodoItemId`; case-insensitive uniqueness is domain-only, no unique-name DB index. |
| `todo_item_shares` | Explicit shared audience | Composite PK `(TodoItemId, SharedWithUserId)`; task FK with cascade; recipient UUID is not an Auth FK. |
| `todo_item_workers` | Per-user task/subtask work membership | Composite PK `(TodoItemId, UserId)`; task FK cascade; required `JoinedAt` default `now()`; owner can hold a row only on subtasks. |
| `user_todo_view_preferences` | Viewer hiding/category/completion | Composite PK `(ViewerId, TodoItemId)`; required hidden/completed flags default false; nullable category and completion date; no task/viewer/category FKs. |
| `OutboxMessages` | Lifecycle, notification and sync events | PK `Id`; shared outbox contract; `(Status, OccurredOnUtc)` and processed-time indexes, without the active partial index used by Auth/Category/Messaging/Realtime. |

> The comment thread no longer lives in the Todo database. It moved to the
> **Collaboration** service (`planora_collaboration.collaboration.comments`). Todo only
> publishes task-lifecycle facts (`TaskCreated` / `TaskActivity` / `TaskDeleted`) via its
> outbox; Collaboration consumes them and materialises system comments. Genesis is
> synthesized from the live task description on reads, rather than persisted. See the
> **Collaboration Database** section below.

### Important Configuration

| Entity | Important fields/indexes | Code |
|---|---|---|
| `TodoItem` | title max 1500 (a subtask's content lives in its title; regular-task titles stay ≤200 via the create validator + UI); description max 2000; status stored as string; priority stored as int; user/category ids; `IsPublic`; `Hidden`; `RequiredWorkers` (nullable int, total headcount including owner); estimated-completion date held as `DueDate` (`timestamptz`, the single target date / **later** bound of an interval) plus optional `DueDateStart` (`timestamptz`, the **earlier** bound — null for a single date; invariant `DueDateStart ≤ DueDate` enforced in the domain `SetDueRange`); soft delete; indexes by user/category/status/delete/created plus a `(UserId, Status, IsDeleted, CompletedAt)` covering index (`ix_todo_items_user_status_deleted_completed`) that serves the completed-archive date-range search. On existing migration-built DBs the `Title` column is widened to `varchar(1500)`, `DueDateStart` is added, and the completion-date index is ensured at TodoApi startup (idempotent, metadata-only) so they match the EF model | `Persistence/Configurations/TodoItemConfiguration.cs` |
| `TodoTag` | owned table `todo_tags`, tag name max 50 | `TodoItemConfiguration.cs` |
| `TodoItemShare` | table `todo_item_shares`, composite key `(TodoItemId, SharedWithUserId)`, index by shared user | `Persistence/Configurations/TodoItemShareConfiguration.cs` |
| `TodoItemWorker` | table `todo_item_workers`, composite PK `(TodoItemId, UserId)`, `JoinedAt` default `now()`, cascade FK to `TodoItems`; indexes on `UserId` and `TodoItemId` | `Persistence/Configurations/TodoItemWorkerConfiguration.cs` |
| `UserTodoViewPreference` | table `todo.user_todo_view_preferences`, composite key `(ViewerId, TodoItemId)`, `HiddenByViewer`, `CompletedByViewer` bool, `CompletedByViewerAt` nullable datetime, optional `ViewerCategoryId`, index `(TodoItemId, ViewerId)` | `Persistence/Configurations/UserTodoViewPreferenceConfiguration.cs` |
| `OutboxMessage` | table `todo.OutboxMessages`, status stored as string, indexes `(Status, OccurredOnUtc)` and `ProcessedOnUtc`; shipped by the shared `OutboxProcessor` | `Persistence/Configurations/OutboxMessageConfiguration.cs` |

### Worker Capacity Semantics

For a top-level task, `RequiredWorkers` is total headcount including the owner. A value of 2
allows one non-owner slot. The owner is not stored in `todo_item_workers` for top-level tasks.
Subtasks have independent per-user worker membership, including the owner, and do not inherit
the parent's capacity. Capacity is full when `Workers.Count >= RequiredWorkers - 1` when a
capacity is set.

Share replacement evicts workers outside the explicit share set plus the owner; this cleanup
also runs on public tasks. Making a task private performs the same cleanup. Reducing capacity
evicts the most recently joined workers first. Adding a worker touches the parent aggregate
so `xmin` guards concurrent capacity checks.

### Todo Schema Bootstrap

The repository `.gitignore` lists `**/Migrations/**`; adding an ignored migration requires an
explicit repository-policy decision. Do not use `git add -f` without authorization. Current
tracked Todo migrations are:

| Migration name | Date | Change |
|---|---|---|
| `20260511105105_AddViewerCompletion` | 2026-05-11 | Adds `CompletedByViewer` and nullable `CompletedByViewerAt` to an existing preference table; this is not an initial-schema migration. |
| `RemoveCommentsAddOutbox` | 2026-05-29 | **Drops `todo_item_comments`** (the timeline moved to the Collaboration service) and creates `todo.OutboxMessages` so Todo can publish task-lifecycle integration events. Run the Collaboration backfill (`Planora.Migrator --backfill-collaboration`) **before** this migration is applied in production so no comment is lost. |
| `20260602111500_AddSubtaskParentTodoId` | 2026-06-02 | Adds nullable `ParentTodoId`, self-reference FK and `(ParentTodoId, IsDeleted, CreatedAt)` index. |
| `AddTodoCreatedByUserId` (startup ALTER) | 2026-06-16 | Adds nullable `CreatedByUserId uuid` to `todo.TodoItems`. Records who created a subtask (a collaborator may now add one) so the creator — as well as the parent owner — can rename/delete it; null for top-level tasks. Applied idempotently at TodoApi startup (`ADD COLUMN IF NOT EXISTS`, see `Planora.Todo.Api/Program.cs`), so existing databases pick it up on the next deploy without a formal EF migration. |
| `AddTodoDueDateStart` (startup ALTER) | 2026-06-19 | Adds nullable `DueDateStart timestamptz` to `todo.TodoItems`. Turns the estimated-completion date into an optional interval: the existing `DueDate` becomes the later bound (deadline / single target date) and `DueDateStart` the earlier bound (null for a single date). Additive and backward-compatible — existing rows keep their single `DueDate`. Applied idempotently at TodoApi startup (`ADD COLUMN IF NOT EXISTS`, see `Planora.Todo.Api/Program.cs`); no formal EF migration committed. |
| `AddTodoCompletedAtIndex` (startup CREATE INDEX) | 2026-06-21 | Adds the `(UserId, Status, IsDeleted, CompletedAt)` covering index `ix_todo_items_user_status_deleted_completed` to `todo.TodoItems`. Backs the completed archive's "find a task by roughly when it was finished" date-range search — all three leading columns are equality predicates and `CompletedAt` is the range bound, so the search becomes an index range scan instead of scanning every one of a user's done tasks. Applied idempotently at TodoApi startup (`CREATE INDEX IF NOT EXISTS`, see `Planora.Todo.Api/Program.cs`); no formal EF migration committed. A very large production table would prefer a one-off `CREATE INDEX CONCURRENTLY`. |

Startup also widens `Title` to `varchar(1500)` and ensures the soft-delete retention index.
These reconciliation statements log a warning and continue when they fail; they are not
versioned migrations and do not appear in `__EFMigrationsHistory`. PostgreSQL `xmin` is a
system concurrency column, not a column added by a migration.

For an existing compatible schema with its full migration history, apply manually:

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

| DbSet | Purpose | Key and important constraints |
|---|---|---|
| `Categories` | User-owned labels | PK `Id`; required name ≤50/color ≤7/owner UUID/order; nullable description ≤500, icon and parent UUID; order default 0, color EF default `#007BFF`, delete default false; conventional parent navigation; no DB unique name/default-category index; `xmin` concurrency and soft-delete filter. |
| `OutboxMessages` | Integration outbox | PK `Id`; shared contract; active partial polling index. |

### Important Configuration

| Entity | Important fields/indexes | Code |
|---|---|---|
| `Category` | name required max 50; description max 500; color required max 7 default `#007BFF`; optional icon; user id; order default 0; soft delete; indexes by user/delete/created | `Persistence/Configurations/CategoryConfiguration.cs` |

Color validation is in `Services/CategoryApi/Planora.Category.Domain/Enums/CategoryColors.cs`.
The create handler supplies `#000000` when no color is provided; the EF `#007BFF` default is
therefore not the normal API default. Parent/archive fields exist in the model but the
current CRUD request contracts do not expose category hierarchy or archival operations.

Committed migrations are not stored in the repository. Category schema is derived from `CategoryDbContext` plus configuration classes under `Services/CategoryApi/Planora.Category.Infrastructure/Persistence/Configurations`.

Runtime startup applies user-created migrations if they exist; otherwise it creates the schema from the current model.

## Messaging Database

DbContext: `Services/MessagingApi/Planora.Messaging.Infrastructure/Persistence/MessagingDbContext.cs`

### Tables / DbSets

| DbSet | Purpose | Key and important constraints |
|---|---|---|
| `Messages` | Direct messages | PK `Id`, never database-generated; required subject ≤200/body/sender/recipient/created time; nullable read time; archived default false; required `AttachmentUrls` JSON text defaults to `[]` in the entity; no sender/recipient FKs or global soft-delete filter. |
| `OutboxMessages` | Integration outbox | PK `Id`; shared contract and active partial polling index. |
| `InboxMessages` | Inbox primitive; no active Messaging subscriber | PK `Id`; convention-mapped required message ID/type/content/received time/status and nullable processed time/error; no dedicated Inbox configuration or unique `MessageId` index. |

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

Owns the task **comment timeline** — regular user comments and auto-generated system
comments (created / completed / started / left). The pinned "Author's Note" (the task description)
is **not** stored here: it is the single source of truth on the task (Todo) and is synthesised on
read from `TodoService.CheckTaskCommentAccess` (which now also returns the live `description` +
`taskCreatedAt`). The service never reads the Todo database (INV-OWN-1) and resolves author identity
(name + avatar) live through Auth's `GetUserProfilesBatch` gRPC (60 s in-memory cache via
`CachingUserService`) — no stored copy of the name.

### Tables / DbSets

| DbSet/table | Purpose | Key and important constraints |
|---|---|---|
| `comments` | User/system timeline and replies | PK `Id`; required task/author UUIDs, author fallback ≤200, content ≤5000; nullable reply kind ≤16/target UUID/author UUID/name ≤200/preview ≤300; system/genesis/reply-deleted flags default false; `xmin`; no task/author/reply FK and no global query filter. Author's Note is synthesized from Todo, not stored. |
| `OutboxMessages` | Notifications and live branch sync | PK `Id`; shared contract, without active partial polling index. |
| `InboxMessages` | Replay suppression | PK derived from `(event id, handler type)`; required message ID/type ≤255/content/received time/string status; nullable processed time/error ≤2000; `(Status, ProcessedOn)` index; no unique `MessageId` index. Effects and inbox record are separate saves. |

### Important Configuration

| Entity | Important fields/indexes | Code |
|---|---|---|
| `Comment` | PK `Id`, `TaskId` (value link to the Todo task — no FK, INV-OWN-1), `AuthorId`, `AuthorName` max 200 (fallback only — identity resolved live), `Content` max 5000, `IsSystemComment`/`IsGenesisComment` bool (default false; new rows never set genesis — kept only so legacy genesis rows are filtered out on read), **reply reference** (`ReplyToType` string `"Comment"\|"Subtask"` max 16 NULL, `ReplyToId` uuid NULL, `ReplyToAuthorId` uuid NULL, `ReplyToAuthorName` max 200 NULL — write-time snapshot, identity re-resolved live on read, `ReplyToPreview` max 300 NULL — one-line quote excerpt, `ReplyToDeleted` bool NOT NULL default false — set when the quoted comment/subtask is gone), soft delete, `xmin` optimistic concurrency; indexes `(TaskId, CreatedAt)` for timeline reads, `AuthorId` for the user-deletion cascade / moderation scans, and `(TaskId, ReplyToId)` for the reply-target cascades (SubtaskDeleted quote flagging, live-preview batch loads) | `Persistence/Configurations/CommentConfiguration.cs` |
| `OutboxMessage` | table `collaboration.OutboxMessages`, status stored as string, indexes `(Status, OccurredOnUtc)` and `ProcessedOnUtc` | `Persistence/Configurations/OutboxMessageConfiguration.cs` |

### Event Flow

- **Inbound (Inbox):** subscribes to `TaskCreatedIntegrationEvent`, `TaskActivityIntegrationEvent`,
  `TaskDeletedIntegrationEvent`, `SubtaskDeletedIntegrationEvent` (from Todo) and `UserDeletedIntegrationEvent` (from Auth).
  Recorded `(event id, handler type)` keys suppress a later replay. Handler effects and the
  subsequent inbox insert are separate saves; crashes/concurrent deliveries or failed inbox
  operations can still repeat side effects. See [architecture.md](architecture.md#outbox-delivery-semantics).
- **Outbound (Outbox):** `AddComment` writes a `NotificationEvent` per participant
  (owner + workers + shared-with, minus the author) so RealtimeApi can push a SignalR notification.

### Collaboration Schema Bootstrap

No committed EF migration: like Category, the schema is created on first run via
`DatabaseStartup.EnsureReadyAsync` → `EnsureCreatedAsync`. The database `planora_collaboration`
is auto-created at startup by `DependencyWaiter.WaitForPostgresWithDatabaseCreationAsync`.

**Upgrading a pre-replies database:** `EnsureCreatedAsync` never alters an existing schema, so a
`comments` table created before the reply feature lacks the `ReplyTo*` columns. Run the idempotent
upgrade once (fresh installs never need it):

```powershell
dotnet run --project tools/Planora.Migrator -- --upgrade-collaboration-replies
```

It executes `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` for the six reply columns and
`CREATE INDEX IF NOT EXISTS` for `(TaskId, ReplyToId)` — safe to run twice.

### Data Migration From Todo

When extracting from an existing deployment, run the idempotent backfill **before** dropping the
old table:

```powershell
dotnet run --project tools/Planora.Migrator -- --backfill-collaboration
```

It copies `planora_todo.todo.todo_item_comments` → `planora_collaboration.collaboration.comments`
with `INSERT ... ON CONFLICT (Id) DO NOTHING`, so it is safe to run twice (once ahead of time, once
at cutover to capture the window).

## Realtime Persistence

`RealtimeDbContext` owns the durable notification read-model. The DbContext is wired conditionally on
`ConnectionStrings__RealtimeDatabase`; ephemeral/test hosts without it fall back to in-memory
behavior (ephemeral SignalR push, empty read API). Live connection presence still uses the Redis
backplane; notifications are now persisted so an offline recipient is caught up on reconnect and the
UI can query unread counts.

| Table | Purpose | Notable columns / constraints |
|---|---|---|
| `Notifications` | Persisted notification log | PK `Id`; required user UUID/title ≤200/message ≤2000/type ≤64/occurred time/source UUID; `TaskId` and `ActorId` are **non-null UUIDs**, `Guid.Empty` is the absence sentinel; required read flag default false/read time nullable; unique `SourceEventId`; user/read/task/time indexes; global soft-delete filter; no cross-service FKs. |
| `NotificationDeliveries` | Delivery-state scaffold | PK `Id`; required notification/user UUIDs and string status ≤32; attempt count default 0; nullable delivery time/error ≤2000; unique `(NotificationId, UserId)`; **no notification FK**; no runtime writer. |
| `OutboxMessages` | Shared outbox schema, currently unused as a producer | PK `Id`; shared contract and active partial polling index. |

Migration: `20260615211750_InitialRealtimeNotifications` is tracked and creates all three tables.
A configured non-`Testing` host waits for PostgreSQL and creates the database before Redis/RabbitMQ
subscriptions can consume notifications. Empty databases and databases with known EF history use
`DatabaseStartup.EnsureReadyAsync`: migrations when compiled, otherwise the current-model fallback.
Docker explicitly includes the three tracked Realtime migration files; other migration directories
remain excluded until their chains are reviewed. Builds intentionally compiled without migrations
retain the current-model fallback.
`Planora.Migrator --service realtime` remains available for a deliberate migration rollout.

An existing model-created database with no applied history is verified against the current mapped
tables, column types/nullability, primary keys and unique keys. Compatible data is preserved without
creating or stamping migration history; a future upgrade still needs an explicit migration plan.
Missing tables/columns, incompatible definitions or unknown applied migration IDs fail startup
instead of recreating tables or adopting history. Transient PostgreSQL failures are retried with
cancellation support. `Testing` hosts skip external startup; an unconfigured durable log remains
optional. New generated migration files remain ignored until explicitly approved for tracking.

`NotificationDelivery` is a schema/domain scaffold: the current notification consumer and
SignalR service do not create or update delivery records. There is no server-side replay on
hub reconnect. Persisted notifications remain available through the read API; this does not
guarantee delivery of every missed toast.

Code:

- `Services/RealtimeApi/Planora.Realtime.Domain/Entities/Notification.cs`
- `Services/RealtimeApi/Planora.Realtime.Infrastructure/Persistence/RealtimeDbContext.cs`
- `Services/RealtimeApi/Planora.Realtime.Infrastructure/Services/NotificationStore.cs` (write side, idempotent)
- `Services/RealtimeApi/Planora.Realtime.Infrastructure/Services/NotificationReadStore.cs` (read side)
- `Services/RealtimeApi/Planora.Realtime.Application/Handlers/NotificationEventHandler.cs` (persist + push)

## Outbox / Inbox Pattern

The shared outbox row requires `Id`, type ≤255, JSON content, occurrence time, string status
and retry count (default 0); processed time, next retry and error ≤2000 are nullable.
Statuses are Pending, Processing, Processed, Failed and DeadLettered. `MarkAsFailed` budgets
three failures: the first two schedule 1-minute/5-minute retry timestamps while returning
to Pending; the third dead-letters. The canonical repository and shared processor select Pending rows
only when `NextRetryUtc` is absent or due, so those timestamps enforce the backoff. Failed rows are
selected when their retry is due; terminal dead-lettered rows are retained for operator replay.

Outbox and inbox primitives exist in shared infrastructure:

- `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Outbox`
- `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Inbox`

All six service contexts expose an outbox table. Auth, Messaging and Collaboration expose
inbox DbSets, but only Collaboration registers `IInboxRepository` for the event bus. Todo,
Category and Realtime do not use a bus inbox; Realtime notifications deduplicate on
`SourceEventId`. Todo also consumes friendship removal. See [architecture.md](architecture.md)
for the distinction between table availability, registration and actual consumption.

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
planora_collaboration
planora_realtime
```

## Data Retention Policies

An hourly background purge (`RetentionBackgroundService`) physically removes stale rows. Windows are
env-configurable (`Retention__*`, see `configuration.md`); the subsystem runs by default (it shipped
disabled + dry-run until 2026-10, so nothing had ever been purged) and each pass is guarded by an advisory
lock + tripwire. Every policy below is run live on PostgreSQL by the `Retention/Postgres` test suite.

| Table / entity | Service | Purged when | Scan index |
|---|---|---|---|
| any soft-deleted row (`TodoItems`, `Categories`, `comments`, …) | owning service | `IsDeleted` and `DeletedAt` older than `SoftDeleteGraceDays` (7) | `(IsDeleted, DeletedAt)` |
| `TodoItems` (completed) | Todo | `Status=Done` and `CompletedAt` older than `CompletedTaskDays` (30) → soft-deleted via cascade, then purged after grace | `(UserId, Status, IsDeleted, CompletedAt)` |
| `user_todo_view_preferences` | Todo | deleted alongside their task (no FK/cascade, so purged explicitly); a viewer-only completion is hidden for that viewer `CompletedTaskDays` (30) after `CompletedByViewerAt` — or at once when it has no timestamp — which removes the task from all of that viewer's lists | `(TodoItemId, ViewerId)` |
| `todo_item_workers` (a viewer who completed the task) | Todo | removed whenever the same viewer's preference row records a personal completion on a live top-level task (`TodoCompletedViewerReleasePolicy`) — finishing your part ends your work on it | PK `(TodoItemId, UserId)` |
| `Notifications` (read) | Realtime | `IsRead` and `ReadAtUtc` older than `ReadNotificationDays` (3) | `(IsRead, ReadAtUtc)` |
| `Notifications` (unread) | Realtime | `!IsRead` and `OccurredOnUtc` older than `UnreadNotificationDays` (90) | `(IsRead, OccurredOnUtc)` |
| `Notifications` / `NotificationDeliveries` | Realtime | cascade-deleted when their task or user is deleted; deliveries also purged after `NotificationDeliveryDays` (30) | `(DeliveredAtUtc)` |
| `OutboxMessages` / `InboxMessages` | all | `Status=Processed` older than `OutboxProcessedDays` / `InboxProcessedDays` (7) | `(Status, ProcessedOnUtc)` |
| `RefreshTokens` | Auth | `ExpiresAt` older than `ExpiredRefreshTokenDays` (30) | `(ExpiresAt)` |
| `Users` (soft-deleted) | Auth | `IsDeleted` and `DeletedAt` older than `SoftDeleteGraceDays` (7) — avatar cleanup must succeed first; then a bespoke policy deletes all Auth-owned dependents (friendships, refresh tokens, login/password history, recovery codes, roles) and the user. An avatar failure retains that account for the next pass without blocking other accounts | `(IsDeleted)` |
| `todo_item_shares` / `todo_item_workers` / `user_todo_view_preferences` naming a deleted user | Todo | at account deletion (`UserDeletedIntegrationEvent`): the rows the account left on other people's tasks are removed with the soft-delete of its own tasks | — |
| `LoginHistory` | Auth | opt-in: `LoginAt` older than `LoginHistoryDays` (180) | `(LoginAt)` |
| `AuditLogs` | Auth | opt-in: `CreatedAt` older than `AuditLogDays` (365) | `(CreatedAt)` |
| `UserRecoveryCodes` (used) | Auth | spent codes (`IsUsed`) older than `RecoveryCodeUsedDays` (30) | — (tiny table) |
| `Friendships` (terminal) | Auth | opt-in: Rejected/Cancelled/Removed older than `FriendshipTerminalDays` (90) | — (small table) |
| `Messages` | Messaging | opt-in (user content): `CreatedAt` older than `MessageDays` (365) | `(CreatedAt)` |

Dead-lettered / failed outbox/inbox rows are deliberately kept for investigation. The `(IsDeleted,
DeletedAt)` scan indexes land via the EF model on the migration-less services (created by `EnsureCreated`)
and via idempotent startup DDL on TodoApi and RealtimeApi; no new EF migration was added.
