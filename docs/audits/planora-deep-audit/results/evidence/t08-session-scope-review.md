# T08 independent session scope review

Reviewed the complete sources on 2026-11-04 in Europe/Moscow at HEAD `05dab9c6ca72f2e85cc6d3c4b49989d60ca9a58d`. The review found a conditional trust-boundary gap and a cancellation gap. The cancellation correction was reread in source. Root reported 45 passing guard cases from a separate execution. The provider cases written by this reviewer fall outside the independent review scope.

| File | Full range | SHA256 |
| --- | --- | --- |
| `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Persistence/PostgreSqlCatalogScope.cs` | 1-179 | `cb95eeb87a5330c32cef56da7d766e9db6bf591d8863ef805bea196c950601fc` |
| `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Persistence/VersionedDatabaseStartup.cs` initial review | 1-251 | `b5e95e2e482525178aa307062a6e2d2559e87a37a71e0a377b22edfb0774a261` |
| `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Persistence/VersionedDatabaseStartup.cs` follow-up | 1-252 | `035c6c8d1670a10792ad3219dfaa30e93c42898f67bbdf822c02eb9068279877` |

## Findings

### P2 conditional — implicit temporary type resolution precedes the catalog

`PostgreSqlCatalogScope.cs:67` sets `search_path` to `pg_catalog`. PostgreSQL implicitly searches the session's temporary schema first for relation and type names when `pg_temp` is absent from the explicit path. `PostgreSqlPreparationObjects.cs` and `PostgreSqlSchemaCompatibility.cs` qualify catalog relations but still use casts such as `c.relkind::text`. A same-session temporary type or domain named `text` is therefore a relevant shadowing probe. A domain check could run user code during the cast if the provider resolves it as the temporary type. This requires a connection with pre-existing temporary objects and has only been traced in source. Use an explicit `pg_catalog, pg_temp` order or qualify the metadata cast types, and verify with a disposable preopened-session probe. [PostgreSQL search path rules](https://www.postgresql.org/docs/16/runtime-config-client.html#GUC-SEARCH-PATH)

### P3 — execution-strategy backoff cancellation corrected in source

The initial version at `VersionedDatabaseStartup.cs:26` and `:83` used the `ExecuteAsync(Func<Task>)` overload. The database commands received the caller token, while the retry strategy used its default token. Cancellation during a transient retry delay therefore reached the next attempt only after that delay. The follow-up passes `cancellationToken` to both execution-strategy calls. A controlled transient failure followed by cancellation during backoff remains an executable verification case.

## Lock, transaction and CLI traces

- `PostgreSqlCatalogScope.cs:46-68` reuses the caller's EF transaction or begins its own read-only transaction. It captures the original path and applies a transaction-local setting. Disposal restores the path with an independent bounded token, rolls back only the owned transaction, and clears the pool and closes the connection when cleanup leaves session state uncertain. The catch paths in `PostgreSqlSchemaCompatibility.cs:196-212` pass the operation error into cleanup, preserving both failures when needed.
- `VersionedDatabaseStartup.cs:123-216` uses a session path of `public, pg_temp` for preparation and restores the caller's previous setting. Its pre-held check distinguishes the bigint advisory key through `pg_locks`. It sets `lockRequested` before awaiting acquisition, so the cleanup path can release an acquisition whose response was canceled. A pre-held lock skips acquisition and unlock. Normal transaction commit releases the additional transaction-level hold and the session-level hold remains through migration and final verification. A retry starts at the outer session wrapper and rereads history after taking the lock. [PostgreSQL advisory locks](https://www.postgresql.org/docs/16/explicit-locking.html#ADVISORY-LOCKS)
- `VersionedDatabaseStartup.cs:29-61` checks history and physical shape before adoption. Fallback catches only `DatabaseSchemaCompatibilityException`, while cleanup uncertainty throws a distinct `InvalidOperationException`. The explicit ceiling limits which compiled prefix can be stamped. A retry after an ambiguous adoption commit rereads the recorded prefix before considering another stamp. Connection-loss and commit-ambiguity scenarios remain provider test concerns. [EF Core connection resiliency](https://learn.microsoft.com/en-us/ef/core/miscellaneous/connection-resiliency#transaction-commit-failure-and-the-idempotency-issue)
- `VersionedDatabaseStartup.cs:109-116` checks preparation metadata before calling EF's history reader. The supplemental metadata helper checks enabled database event triggers, temporary history shadowing, the permanent relation kind, security/trigger/rule/inheritance flags, columns, the primary key and its index. `tools/Planora.Migrator/Program.cs:174-190` computes pending IDs from the validated applied prefix and returns before the database creation and migration branches. This CLI path still takes an advisory lock and changes the session path temporarily.

The preparation lock coordinates callers that participate in the same protocol on a session-affine connection. The metadata check and subsequent EF history access do not form a barrier against a separate privileged connection issuing arbitrary DDL. The deployment window must exclude such writers. This review used source reads, hashes and primary documentation. Root owns the separate build and disposable provider results.
