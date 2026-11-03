# T08 schema inventory and proposed guarded baseline

Read-only source snapshot: `f12f038e7b545456f82cb6e256592a3c8544d355`.
The [JSON inventory](t08-schema-inventory.json) records six contexts, 55 source hashes,
tracked migration paths and the absence of ignored local migration paths at inspection.
No working database, migration history or ignored migration source content was read.

## Current reproducibility

| Service | Schema | Tracked migration IDs | Current startup |
| --- | --- | --- | --- |
| Auth | `public` | 0 | Shared helper falls back to model creation |
| Category | `public` | 0 | Shared helper falls back to model creation |
| Collaboration | `collaboration` | 0 | Shared helper falls back to model creation |
| Messaging | `public` | 0 | Shared helper falls back to model creation |
| Todo | `todo` | 9 | Guarded historical adoption and reviewed upgrade chain |
| Realtime | `public` | 1 | Guarded managed/fresh path; compatible unmanaged schema remains unmanaged |

All six Infrastructure project files use default compile inclusion with no explicit
`Compile` overrides. No migration attributes were found in the four migration-less
service source trees. These are source-inferred compiled sets; this reviewer did not
reflect over runtime assemblies or query any applied database history. Existing Todo
and Realtime provider-test sources inspect actual `GetMigrations`/applied histories.

`.gitignore` and `.dockerignore` admit only the reviewed Todo/Realtime paths. Newly
generated service migration paths must be obtained from EF tooling and reviewed before
adding narrow exceptions. Global `dotnet-ef` **10.0.8** is installed; the local tool
manifest does not pin it. This inspection installed nothing and ran no EF command.

## Confirmed source risks

- **BE-007:** `DatabaseStartup` uses `EnsureCreatedAsync` when the compiled chain is
  empty. Existing schemas are not upgraded. The four missing chains need a reviewed
  baseline rather than copied or invented historical IDs.
- **Auth model seed:** `RoleConfiguration.HasData` invokes `Role.Create`, producing
  fresh GUIDs and timestamps through `BaseEntity`. `AuthDbContext` suppresses the
  pending-model warning. Baseline generation must first stabilize seed behavior.
  Preserve existing role IDs and `UserRoles` references; do not delete/reinsert
  seeded roles merely to match newly generated IDs. Removing dynamic `HasData`
  requires a deliberate fresh-install role bootstrap, since no other role seeder
  was found in the inspected Auth source.
- **Messaging factory:** `MessagingDbContextFactory` reads `DefaultConnection`, has
  no `AddEnvironmentVariables`, and explicitly falls back to the corresponding
  legacy environment key. Runtime DI, Migrator and workflow use `MessagingDatabase`.
  The normal service environment key is ignored by this factory. Root assigned the
  narrow factory/test correction separately; this inventory preserves its prior hash.
- **Migrator divergence:** the CLI checks unknown applied IDs but then calls
  `MigrateAsync` directly. A zero pending set reports success even for a service
  without a reproducible schema chain. It bypasses service schema/adoption guards.
  Startup and one-shot migration must use the same reviewed path; `--list-pending`
  must remain nonmutating and must not imply schema readiness.
- **Known Collaboration predecessor:** the replies upgrade tool adds six columns
  and one index with `IF NOT EXISTS`. This does not prove that an existing same-name
  column/index has the required definition. Recognize and verify the pre-replies
  schema before a separate additive upgrade; reject unknown or conflicting shapes.

## Minimal implementation path

Keep Todo/Realtime unchanged. Add a shared `VersionedDatabaseStartup` and a read-only
`PostgreSqlSchemaCompatibility` helper used by four new service-owned wrappers.
Root owns generated migrations, wrappers, startup/Migrator calls and provider tests.

1. Freeze each current Npgsql model after Auth seed stabilization. Scaffold a real
   per-service baseline with explicit context/project/startup project using existing
   EF 10.0.8. Review SQL, designer and snapshot; record the actual generated ID.
2. Require a nonempty chain beginning with that reviewed ID. Reject unknown/gapped
   applied history and pending model drift before a schema write.
3. Under the provider execution strategy, transaction and a service-specific advisory
   transaction lock, reread history. A schema with no history is adopted only after
   complete baseline equivalence. Write only the reviewed baseline history row in
   that transaction. A partial or unknown schema stops without a history stamp.
4. Commit adoption, apply subsequent EF migrations normally and verify the current
   model. Managed databases are compared with the last applied migration model before
   advancing. Empty stores follow the normal initial migration path.
5. Treat only explicitly verified predecessors as supported. The current unmanaged
   model can adopt the current baseline; missing-column legacy shapes cannot be
   mislabeled as that baseline. A previous supported Collaboration shape needs its
   own reviewed expand/verify path. Unknown deployed versions remain blocked until
   their provenance and upgrade plan are available.

Equivalence must cover schemas/tables; mapped types, nullability, defaults and database
generation; primary/unique keys; validated FK columns/actions; check constraints;
index uniqueness/order/readiness/validity and partial predicates. Handle PostgreSQL
system `xmin` rather than inventing a user column. Reject RLS, noninternal triggers,
unknown write-restricting constraints and unsafe extra columns/objects. Compare catalog
expressions without executing database-supplied defaults/functions. Todo's current
checker cannot be reused unchanged because it rejects partial indexes, while Auth,
Category and Messaging require an active outbox predicate and Auth has a partial
refresh-token uniqueness predicate. PostgreSQL renders `IN` as `ANY(ARRAY...)`, so any
normalization must recognize only proven equivalent literal-membership forms.

## Provider acceptance to implement and run

Use the verified disposable server with `TemporaryDatabase`; no default localhost or
working-stack connection. Add explicit cases for each new service:

- Fresh migration creates every mapped object and exact history; repeated startup is
  a no-op and the model has no pending changes.
- Compatible model-created database with representative rows adopts exactly one
  reviewed baseline, preserving IDs, values and relationship rows.
- Managed known-prefix upgrade preserves representative rows; unsupported legacy,
  unknown/gapped history and partial schemas stop without mutation or history repair.
- Missing/type/nullability/default drift, missing/wrong PK/FK/check/index, wrong
  uniqueness/partial predicate/order, unsafe required extras, triggers and RLS reject.
- Cancellation before creation/adoption and while waiting for the lock; concurrent
  compatible adoption stamps once and preserves rows.
- Auth retains custom/existing role IDs and role assignments, synthetic secret
  ciphertext, sessions, outbox/inbox and dependent rows. Model determinism needs
  independent model/service-provider creation, since EF caches models per provider.
- Category retains hierarchy/defaults; Messaging retains message/attachment JSON and
  convention-mapped inbox shape; Collaboration retains comments/reply snapshots and
  inbox/outbox. Prove recognized pre-replies upgrade separately.
- Runtime factory keys and startup/CLI guards agree. Generated idempotent SQL must
  have meaningful schema content rather than the workflow's current empty-script notice.

No provider test, scaffolding, SQL application, restore or performance experiment was
executed by this inventory. Source verification is not schema acceptance. Schema
rollback must preserve backups and rows; do not invoke destructive `Down` migrations
automatically. Working-environment application remains a separate approved action.
