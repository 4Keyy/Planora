# T08 independent adversarial guard review

Initial review on 2026-11-03 of the root-authored, uncommitted shared helpers.
This reviewer did not modify source, build .NET, apply SQL or connect to a database.
Findings below are source-confirmed acceptance gaps; proposed provider probes are
not claims that those probes have already executed.

Initial source snapshots:

- `PostgreSqlSchemaCompatibility.cs`: `a623fda0eb69c4d669455d2ed5644c6cb4b2e67fe7810a1148f3e0bfec512366`.
- `VersionedDatabaseStartup.cs`: `2fc510de544364f3eb391bfab05855c78d703602627bbcef7d3a702268c59ccd`.

Initial verdict: **needs correction and provider regressions before acceptance**.

## Findings

### P1: unchecked migration-history relation can mutate data during adoption

`PostgreSqlSchemaCompatibility.cs:39` excludes `public.__EFMigrationsHistory` from
the entire relation/security scan. `VersionedDatabaseStartup.cs:55-57` then retains
that existing relation and inserts baseline IDs without validating its triggers,
rules, RLS, persistence, columns or primary key. History is also read before that
scan in `EnsureReadyAsync` and `ValidateHistoryAsync`.

Concrete trigger: a schema matches the unmanaged baseline and contains representative
outbox rows. Its otherwise normal empty history table has an `AFTER INSERT` trigger
that deletes those rows. Equivalence ignores that trigger; adoption inserts fire it;
the final table/history definitions can still match and preparation can return success
after losing rows. A view or foreign relation under the history name also needs to be
rejected before executing a history SELECT that might invoke an unreviewed function.

Required correction: validate any existing history relation from trusted catalogs
before reading or writing it. Exclude only its membership in the business table set,
not its security/definition checks. Add a provider regression proving that the trigger
is rejected before firing and that representative data/history stay unchanged.

### P1/P2: global cast stripping accepts a predicate that breaks future writes

`PostgreSqlSchemaCompatibility.cs:245-249` removes `::integer`, `::boolean`, `::text`
and unbounded varchar casts from arbitrary operands. These are not universally
semantics-preserving transformations.

Concrete trigger: on an empty unmanaged outbox, replace the expected active index
with the same named/keyed index whose predicate coerces `"Status"` through integer
and back to text before comparing it with `Pending`/`Failed`. That index can be
created while empty. The canonicalizer removes those column coercions and can match
the expected literal-membership predicate, while an ordinary subsequent insertion
with `Status=Pending` fails integer conversion.

Required correction: preserve operand coercions. Normalize only proven safe literal
casts in the specific PostgreSQL-rendered membership/default forms needed by the
reviewed model. Add a direct canonicalizer negative case and a provider adoption case
with the conflicting predicate; history must remain unstamped.

### P2: collation name alone does not identify the default collation

`PostgreSqlSchemaCompatibility.cs:60-65` retains `collname` without namespace or OID;
`VerifyColumn` accepts the name `default` for a model without explicit collation.
A user collation `public."default"` can have different locale/determinism and pass
that comparison. The index collation check compares the index with the same altered
column, so it does not close the gap. This matters to the reviewed string and unique
email/role columns.

Required correction: verify collation identity/provenance, including the actual
system default for an implicit default. Reject a user collation with the same short
name. Preserve explicit model-qualified collation semantics if later supported.

### P2: expression text can hide an unreviewed function dependency

`VerifyColumn`, index and check comparisons depend on `pg_get_expr` text. Under a
search path that makes a user routine visible, an actual `public.now()` default may
render as `now()` and match Auth's reviewed `NOW()` even though its behavior differs.
This is a source-inferred probe candidate; the exact server rendering must be
established in a disposable provider regression before claiming runtime reproduction.

Required correction: compare trusted function/operator dependency provenance or use
a safely scoped trusted rendering context that cannot change subsequent DDL targets.
Do not execute stored expressions to test their behavior. A global search-path change
must not accidentally direct unqualified migration-history DDL into `pg_catalog`.

## Additional fail-closed checks

- Enabled database event triggers are not table `pg_trigger` entries. They can fire
  during history creation or migration DDL and need a separate inventory/rejection
  policy before writes. PostgreSQL documents their database scope and DDL behavior in
  [event triggers](https://www.postgresql.org/docs/16/event-triggers.html).
- FK comparison omits `confmatchtype`. Current service FKs are predominantly single
  column, so no current-domain composite-FK regression is claimed. A general guard
  should distinguish reviewed `MATCH SIMPLE` from `MATCH FULL` before supporting
  nullable composite FKs. See the [constraint catalog](https://www.postgresql.org/docs/16/catalog-pg-constraint.html).

## Locking and scope notes

The code holds a session advisory lock across adoption, normal EF migration and final
verification, and an additional transaction lock around catalog checks/history stamp.
It rereads history under that lock and rejects a non-prefix/unknown history. The review
did not identify a concrete cooperative-startup race in that sequence. Cancellation,
connection-pool cleanup, concurrent adoption and transient-retry behavior still need
their provider tests; source inspection is not evidence that they passed.

The reviewed adoption ceiling tries only compiled prefix targets up to an explicitly
provided migration ID. Root must keep that ceiling restricted to reviewed compatible
states. This helper review does not approve service-specific seed bootstrap, migration
SQL, historical data upgrade, production schema application or unsupported legacy shapes.

## Execution limits

Read complete helper source and the initial provider-test source; inspected source
hashes and exact finding locations using `Get-FileHash` and `rg`. No working database,
auth environment, credentials, EF tooling or application process was accessed.
Root owns provider reproduction, corrections and the final executable result.

## Proposed remedy design review

This is a review of the proposed design, not a resolved finding or executable result.
The initial gaps remain open until corrected source and provider evidence are checked.

The proposed combination is sound for the four current built-in-type profiles:
validate the physical history relation and enabled DDL event triggers before any EF
history read/write; use schema-qualified advisory-lock/configuration functions;
render catalog expressions under a trusted local path; and reject unreviewed
function/operator/type/collation dependencies in addition to comparing expression text.

Practical requirements for implementation:

- **Temporary-name shadowing:** a session path of `public` alone still searches an
  existing temporary schema first for relation/type names. EF history SQL with an
  unqualified relation name must not read a temporary history object after validating
  the public one. Use an explicit public history schema consistently, or put
  `pg_temp` explicitly last (`public, pg_temp`) and reject unexpected temporary
  objects before EF history access. The builtin catalog remains implicitly first
  for functions/operators. These lookup rules are stated in the official
  [PostgreSQL search-path documentation](https://www.postgresql.org/docs/16/runtime-config-client.html#GUC-SEARCH-PATH).
- **Separate rendering from DDL:** `SET LOCAL search_path=pg_catalog` belongs only
  around fully qualified read-only catalog queries. Restore the previous local
  setting before history creation/insertion or EF migration. Otherwise unqualified
  DDL can target the first valid schema incorrectly. Keep a separate trusted session
  path scope across the migration sequence and restore the original session path
  for a caller-owned already-open connection.
- **Transaction ownership:** catalog verification may reuse an existing transaction,
  but must not commit or roll it back. When none exists, it can create and dispose its
  own short catalog transaction. Every command must use the matching actual transaction.
  Save/restore path values through parameters and schema-qualified builtin functions.
- **Cleanup after failure:** restoration/unlock use a bounded timeout independent of
  the canceled operation token. An aborted PostgreSQL transaction can reject restoration
  with `25P02`; do not mask the original failure or return a successful comparison.
  A failed trust-scope cleanup must be fatal and discard/close the connection, rather
  than emerge as a compatibility mismatch that the adoption-candidate loop can swallow.
  Ensure rollback/disposal does not affect a caller-owned transaction silently.
- **Dependency scope:** inspect the relevant column/default/index/check dependencies,
  not every structural `pg_depend` edge indiscriminately. Expected application tables,
  row types and FK relationships naturally belong outside `pg_catalog`. The current
  profiles use builtin scalar column types and no reviewed user expression routines;
  unsupported user-defined expression/type/collation features should fail closed.
- **Identity rather than short name:** implicit default collation means the actual
  system default object, not any object named `default`. Explicit future collations
  need model-qualified identity and reviewed semantics. Index operator/collation
  checks supplement rather than replace column/default dependency checks.
- **Ordering:** preflight history relation/security and DDL-trigger state before
  calling `GetAppliedMigrationsAsync`, not merely before a stamp. Perform the same
  protection in nonmutating history/listing mode. Do not certify business schema
  readiness from history validation alone.

A minimal internal API can keep these boundaries explicit: a history/database
catalog preflight called before EF history access, and a scoped catalog-rendering
operation inside `VerifyAsync`. An internal async scope is useful only if it reliably
owns restoration and distinguishes its own transaction from the caller's transaction.
No public abstraction or configuration system is needed for the current four profiles.

Provider follow-up should include existing open connections and nondefault paths,
temporary history shadows, canceled lock waits, restoration on mismatch and SQL error,
repeat/concurrent startup and the initial four adversarial acceptance gaps. This
reviewer performed no database or build command for this design assessment.
