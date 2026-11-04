# T08 catalog and migration CLI source review

The first pass used checkout HEAD `05dab9c6ca72f2e85cc6d3c4b49989d60ca9a58d` and the working-file hashes below. The corrected source review follows the initial findings. This is an independent source review of the three root-authored files. The startup and catalog scope are supporting call traces. The reviewer-authored drift tests and legacy factory are outside the independent claim. Root reported the preceding guard run as 45/45. The combined baseline and CLI runs have separate evidence.

| Reviewed file | Working-file SHA256 |
| --- | --- |
| `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Persistence/PostgreSqlPreparationObjects.cs` | `7349c0b3cb256feb7216e37d990e8dca4440c41bc85a204e8d86feac2f7d72cc` |
| `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Persistence/PostgreSqlSchemaCompatibility.cs` | `b85df1b34fe8e9d47bc26391771c18e976d3e8c9a0b8f7e9449349560d078e20` |
| `tools/Planora.Migrator/Program.cs` | `8c04cc8c7c90a6cb8752df01bb6efb0c7803a75f3b182d70c6d3c025d039998d` |

Supporting snapshots: `PostgreSqlCatalogScope.cs` SHA256 `cb95eeb87a5330c32cef56da7d766e9db6bf591d8863ef805bea196c950601fc`, `VersionedDatabaseStartup.cs` SHA256 `035c6c8d1670a10792ad3219dfaa30e93c42898f67bbdf822c02eb9068279877`.

## Findings

### P1 Todo and Realtime CLI apply can read an unreviewed history relation

`tools/Planora.Migrator/Program.cs:196-205` dispatches all six contexts to service startup helpers. The Todo and Realtime helpers reach `GetAppliedMigrationsAsync` before a catalog check. See `Services/TodoApi/Planora.Todo.Infrastructure/Persistence/TodoDatabaseStartup.cs:23-30` and `Services/RealtimeApi/Planora.Realtime.Infrastructure/Persistence/RealtimeDatabaseStartup.cs:57-78`. The four new versioned paths inspect the relation first in `VersionedDatabaseStartup.cs:112-117`.

For an existing database with a history-shaped view, Todo or Realtime apply can execute the view's volatile expression under the migration session before rejecting the returned history. Npgsql 10.0.2 delegates to EF's history reader, which selects both history columns from the resolved relation. This source trace supports the exposure. A disposable reproduction for these two CLI paths remains pending. [Npgsql history repository](https://raw.githubusercontent.com/npgsql/efcore.pg/v10.0.2/src/EFCore.PG/Migrations/Internal/NpgsqlHistoryRepository.cs), [EF Core history reader](https://raw.githubusercontent.com/dotnet/efcore/v10.0.8/src/EFCore.Relational/Migrations/HistoryRepository.cs)

Hold the reviewed history preflight and trusted session path across each service-specific apply path. A preflight that restores the ambient path before the old helper selects history leaves a shadowing gap. Extend the existing history-view sequence probe to Todo and Realtime apply and require rejection before the sequence is called.

### P1 Combined backfill can write after schema preparation rejects its target

`tools/Planora.Migrator/Program.cs:110-128` records a failed service preparation in `anyFailure` and then starts the requested backfill independently. `tools/Planora.Migrator/CollaborationBackfill.cs:26-47` opens the named Todo and Collaboration connections and defines a direct copy. Line 73 inserts each row without a target compatibility check.

With `--service collaboration --backfill-collaboration`, a structurally usable target with an extra unreviewed table can fail preparation and still receive copied comments. The final exit code is 70 even after the inserts. This pre-existing combination remains reachable through the new guarded runner. The override guard at `Program.cs:87-99` counts selected migration services, while backfill uses its two named connections at `Program.cs:114-128`. A combined invocation can prepare the override target and write to a separate configured Collaboration target.

Make the documented standalone backfill a distinct intent with explicit source and target verification. Reject ambiguous mixed apply or override combinations before opening either connection, or define and test an equivalent fail-closed contract. Preserve the legacy ordering where source comments are copied before Todo removes their table. Regress the rejected-target case with two disposable databases and verify the target row count stays unchanged.

### P2 Disabled Auth foreign-key triggers pass the catalog equivalence checks

`PostgreSqlSchemaCompatibility.cs:31-49` excludes internal triggers from its trigger check. Lines 134-186 compare constraint metadata, including validation, FK columns and actions. They do not inspect trigger firing state. The Auth model uses FK constraints for `UserRoles` in `UserRoleConfiguration.cs:21-29`.

A privileged restore can run `ALTER TABLE public."UserRoles" DISABLE TRIGGER ALL`. PostgreSQL retains internal trigger and constraint metadata while suppressing trigger execution. The observed schema can therefore match the checked catalog fields while losing child-side FK enforcement. A session in replication role `replica` also bypasses normally enabled FK triggers. This is an inference from the checked source and PostgreSQL's documented behavior. [ALTER TABLE trigger controls](https://www.postgresql.org/docs/16/sql-altertable.html), [pg_trigger catalog](https://www.postgresql.org/docs/16/catalog-pg-trigger.html), [Replication role](https://www.postgresql.org/docs/16/runtime-config-client.html#GUC-SESSION-REPLICATION-ROLE)

Verify that FK constraint triggers have the reviewed enabled state and that preparation runs with the reviewed replication role. A disposable Auth regression can disable the child-side triggers and require rejection before history adoption. Cover both physical catalog drift and the session setting.

### P2 Temporary type names can precede the catalog path

`PostgreSqlCatalogScope.cs:54-67` borrows the outer transaction when present and sets the local path to `pg_catalog`. PostgreSQL places an existing temporary schema ahead of that path for unqualified relation and type names unless `pg_temp` is explicitly listed. Catalog queries use unqualified `::text` casts at `PostgreSqlPreparationObjects.cs:21` and `PostgreSqlSchemaCompatibility.cs:32`. The preparation check at `PostgreSqlPreparationObjects.cs:13-17` only rejects a temporary history relation. [PostgreSQL search path](https://www.postgresql.org/docs/16/runtime-config-client.html#GUC-SEARCH-PATH)

For a reused open session with a temporary domain named `text`, the cast can resolve to that domain and run its check. The borrowed transaction used during adoption permits writes. This is a conditional source risk that needs a disposable regression. Explicitly place `pg_temp` after `pg_catalog` and use qualified built-in type names where needed. A sequence-backed domain check can verify that catalog inspection does not invoke it. [PostgreSQL domain checks](https://www.postgresql.org/docs/16/sql-createdomain.html)

### P3 Missing-database list behavior changes

`Program.cs:175-189` now calls `ValidateHistoryAsync`, whose session setup opens the target at `VersionedDatabaseStartup.cs:126-138`. A missing database fails there and becomes exit 70. Before this change, the Npgsql history reader handled `InvalidCatalogName` as empty history and the CLI listed the compiled migrations as pending. The new path still avoids database creation. Confirm whether the CLI should preserve the previous output for an absent target and test the chosen behavior explicitly. [Npgsql 10.0.2 history handling](https://raw.githubusercontent.com/npgsql/efcore.pg/v10.0.2/src/EFCore.PG/Migrations/Internal/NpgsqlHistoryRepository.cs)

## Controls confirmed by source

- For Auth, Category, Collaboration and Messaging, catalog preflight precedes the first EF history query. Preparation checks relation kind, persistence, RLS/policies, triggers, rules, inheritance, exact columns and key/index shape. A missing valid history relation is handled before selecting from it. See `PostgreSqlPreparationObjects.cs:9-115` and `VersionedDatabaseStartup.cs:112-117`.
- Unmanaged adoption compares a compiled reviewed target before history creation and insertion. Known applied history must be an ordered prefix. The last applied target is verified before continuing and the final schema is checked against the current design-time model. The model-change guard runs before the preparation session. See `VersionedDatabaseStartup.cs:16-73` and `91-109`.
- The comparator checks table membership, columns, indexes and constraints. Its outbox predicate normalization is restricted to the reviewed `Status IN ('Pending','Failed')` form and its PostgreSQL `ANY` rendering. It compares expression syntax under a catalog path and checks non-catalog dependencies. The identified trigger and temporary-type cases limit that safety claim. See `PostgreSqlSchemaCompatibility.cs:30-194` and `214-377`.
- `--list-pending` returns before creator/apply dispatch and suppresses backfill. It checks history provenance and holds a cooperative session lock with bounded cleanup. It performs no persistent schema or data mutation in the reviewed normal path. Pending names describe compiled history and do not certify physical schema parity. See `Program.cs:114-128`, `175-205` and `VersionedDatabaseStartup.cs:76-88`, `126-219`.
- The old replies flag adds Collaboration once to the canonical service selection. Apply takes the guarded Collaboration chain and list uses the same history-only branch. A connection override with more than one selected migration service returns 64 before service dispatch. Explicit apply still provisions a missing database before the service-specific preparation check. See `Program.cs:75-110`, `171-205`, `270-278` and `323-326`.

## Initial review limits and disposition

Source review only. Runtime cases, compiler and CLI execution are tracked in root's separate verification. The cooperative advisory lock serializes participating preparers. Other DDL writers still require the controlled rollout window and authorization boundaries. Database role configuration, actual deployed catalog state, migration application and historical data repair remain outside this review.

The all-six catalog-first claim and combined backfill safety need correction before CLI acceptance. The schema equivalence findings need targeted tests or an explicitly bounded supported profile with a recorded prerequisite. The missing-database list change needs an intentional compatibility decision.

## Corrected source review

The follow-up inspected these working-file snapshots at the same HEAD. Root owns the RED/GREEN runs and CLI execution evidence.

| File | Corrected working-file SHA256 |
| --- | --- |
| `PostgreSqlPreparationObjects.cs` | `5b0ad5386e2b97d214cf90ea08f7136918c84d268137e929c602b1dca4f0c7c2` |
| `PostgreSqlSchemaCompatibility.cs` | `ca04c10e14e909f9564dba0a5dadde100f436b916290756e040bf8db1a4a320f` |
| `tools/Planora.Migrator/Program.cs` | `6a8084f1aec7cb337aa9bd334bc837a5c93a90e14cfae6c8a7a923dc9fd1996e` |
| `PostgreSqlCatalogScope.cs` | `575f6a3ba9c15ccd308f0b0d70e2b4c432f59dd5e6255123686cebf4fe959bf5` |
| `VersionedDatabaseStartup.cs` | `d31073e6986946a8287cd5f14c38e3dad7010138b374abe81261f9991d6962c1` |

- Todo and Realtime CLI apply now call `ValidateHistoryAsync` before their existing helpers at `Program.cs:199-210`. `Program.cs:243-244` pins `public, pg_temp` in CLI context options so subsequent connections retain the same intended relation resolution. This closes the initial catalog-first exposure for CLI use on a quiescent target. The preflight and legacy helper remain separate phases. The older service runtime startup paths are outside this closure, and other DDL writers require a controlled window.
- `Program.cs:88-91` rejects an override combined with cross-store backfill before dispatch. `Program.cs:112-129` gates copying on successful requested preparation. This closes the reported failed-preparation and mixed-override triggers. Standalone backfill remains a separately authorized copy with documented source/target prerequisites.
- `PostgreSqlSchemaCompatibility.cs:34` rejects internal triggers outside normal enabled state and continues to reject user triggers. `PostgreSqlPreparationObjects.cs:11-14` requires the `origin` session role before history inspection. This closes the reported disabled-trigger and replica-session cases in the reviewed profiles.
- `PostgreSqlCatalogScope.cs:67` explicitly places `pg_temp` after `pg_catalog`. The table inventories exclude temporary schemas at `PostgreSqlSchemaCompatibility.cs:38` and `VersionedDatabaseStartup.cs:246`. The specific temporary history shadowing rejection remains at `PostgreSqlPreparationObjects.cs:15-19`. This closes the documented temp-type precedence gap in the source path.
- `Program.cs:175-194` checks target existence and lists the compiled chain when the target is absent. The list branch returns before the database-create call and still suppresses backfill. This restores the prior missing-database behavior while keeping list inspection read-only.

### P2 Connection pinning parses invalid overrides outside the service error boundary

The corrected `Program.cs:243-244` constructs `NpgsqlConnectionStringBuilder` during `AddDbContext`. `RunForServiceAsync` invokes that method at line 163 before its `try` at line 168. An invalid nonempty connection string can now throw out of `Main` before the service failure is collected at lines 111-112. This changes the documented exit-70 path and can abort a multi-service run before other targets are considered. The previous options delegate deferred provider configuration until context resolution inside the service error boundary.

Defer connection-string parsing and search-path pinning into the options delegate, or bring registration into the existing per-service `try`. Verify malformed connection input returns 70 with sanitized diagnostics. This follow-up is a source finding. The reviewed correction snapshot still contains the early parse.

## Final CLI delta

Final reviewed `Program.cs` SHA256 `6f6f82176418bee70c11bba9f9dcc7059168059a20935661e7946200ed726500`. Lines 243-247 now construct the pinned connection string inside the EF options delegate. Service registration stores the delegate, and context resolution at lines 168-170 occurs inside the existing error boundary. This closes the early-parse finding by source. Malformed input exit behavior and the six-service smoke remain separate executable gates.

The reported issues are closed by source within the reviewed CLI and catalog profiles. The operational prerequisite is a quiescent target during preflight and apply. The independent review covers the final source delta and leaves runtime acceptance to root's recorded tests.
