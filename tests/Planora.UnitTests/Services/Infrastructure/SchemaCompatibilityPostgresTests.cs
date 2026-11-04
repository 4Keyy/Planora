using System.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Metadata;
using Planora.Auth.Infrastructure.Persistence;
using Planora.BuildingBlocks.Application.Messaging;
using Planora.BuildingBlocks.Application.Outbox;
using Planora.BuildingBlocks.Domain.Interfaces;
using Planora.BuildingBlocks.Infrastructure.Persistence;
using Planora.Category.Infrastructure.Persistence;
using Planora.Collaboration.Infrastructure.Persistence;
using Planora.Messaging.Infrastructure.Persistence;
using Planora.UnitTests.BuildingBlocks.Retention.Postgres;

namespace Planora.UnitTests.Services.Infrastructure;

public sealed class SchemaCompatibilityPostgresTests
{
    [PostgresFact]
    public async Task ShadowedTemporaryType_DoesNotAffectCatalogVerification()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        await using var db = Context("category", database);
        await db.Database.EnsureCreatedAsync();
        await db.Database.OpenConnectionAsync();
        await db.Database.ExecuteSqlRawAsync("""
            CREATE TEMP TABLE audit_temp_scope (id integer);
            CREATE DOMAIN pg_temp.text AS pg_catalog.text CHECK (VALUE <> 'r');
            SET search_path TO public, pg_catalog;
            """);

        await VerifyCurrentModel(db);

        Assert.Equal("public, pg_catalog", await db.Database.SqlQueryRaw<string>(
            "SELECT pg_catalog.current_setting('search_path') AS \"Value\"").SingleAsync());
        Assert.True(await db.Database.SqlQueryRaw<bool>("""
            SELECT pg_catalog.to_regclass('pg_temp.audit_temp_scope') IS NOT NULL AS "Value"
            """).SingleAsync());
    }

    [PostgresFact]
    public async Task DisabledForeignKeyTriggers_AreRejectedDespiteMatchingConstraintMetadata()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        await using var db = Context("auth", database);
        await db.Database.EnsureCreatedAsync();
        await VerifyCurrentModel(db);
        await db.Database.ExecuteSqlRawAsync("ALTER TABLE public.\"UserRoles\" DISABLE TRIGGER ALL");

        var error = await Assert.ThrowsAsync<DatabaseSchemaCompatibilityException>(() => VerifyCurrentModel(db));

        Assert.Contains("trigger", error.Message, StringComparison.OrdinalIgnoreCase);
        Assert.False(await HistoryExists(db));
    }

    [PostgresFact]
    public async Task ReplicaSession_IsRejectedBeforeAdoption()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        await using var db = Context("category", database);
        await db.Database.EnsureCreatedAsync();
        await db.Database.OpenConnectionAsync();
        await db.Database.ExecuteSqlRawAsync("SET session_replication_role TO replica");

        var error = await Assert.ThrowsAsync<DatabaseSchemaCompatibilityException>(() => VerifyCurrentModel(db));

        Assert.Contains("replication role", error.Message, StringComparison.OrdinalIgnoreCase);
        Assert.False(await HistoryExists(db));
    }

    [VersionedPostgresTheory]
    [InlineData("auth")]
    [InlineData("category")]
    [InlineData("collaboration")]
    [InlineData("messaging")]
    public async Task CurrentModelSchema_PassesReadOnlyVerification_WithoutChangingRowsOrHistory(string service)
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        await using var db = Context(service, database);
        Assert.True(await db.Database.EnsureCreatedAsync());
        var row = await SeedOutbox(db);
        var before = await OutboxFingerprint(db, row.Id);
        Assert.False(await HistoryExists(db));
        Assert.Equal(ConnectionState.Closed, db.Database.GetDbConnection().State);

        await VerifyCurrentModel(db);

        Assert.Equal(ConnectionState.Closed, db.Database.GetDbConnection().State);
        Assert.False(await HistoryExists(db));
        Assert.Equal(before, await OutboxFingerprint(db, row.Id));
    }

    [VersionedPostgresTheory]
    [InlineData("partial-index-predicate")]
    [InlineData("index-uniqueness")]
    [InlineData("index-sort-direction")]
    [InlineData("index-method")]
    [InlineData("index-operator-class")]
    [InlineData("column-type")]
    [InlineData("column-nullability")]
    [InlineData("column-default")]
    [InlineData("missing-column")]
    [InlineData("unexpected-column")]
    [InlineData("missing-primary-key")]
    [InlineData("unexpected-check-constraint")]
    [InlineData("unexpected-table")]
    [InlineData("row-level-security")]
    public async Task CatalogDrift_IsRejected_WithoutChangingTheStoredRowOrCreatingHistory(string drift)
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        await using var db = new CategoryDbContext(database.Options<CategoryDbContext>(), new NoOpDispatcher());
        await db.Database.EnsureCreatedAsync();
        var row = await SeedOutbox(db);
        await VerifyCurrentModel(db);
        var (sql, message) = DriftDefinition(drift);

        // Every DDL statement is a closed test fixture, applied only to this newly created database.
        await db.Database.ExecuteSqlRawAsync(sql);
        var beforeVerification = await OutboxFingerprint(db, row.Id);

        var error = await Assert.ThrowsAsync<DatabaseSchemaCompatibilityException>(() => VerifyCurrentModel(db));

        AssertGuardMessage(error, message);
        Assert.Equal(beforeVerification, await OutboxFingerprint(db, row.Id));
        Assert.False(await HistoryExists(db));
        Assert.Equal(ConnectionState.Closed, db.Database.GetDbConnection().State);
    }

    [PostgresFact]
    public async Task ChangedForeignKeyDeleteAction_IsRejected_WithoutChangingRowsOrHistory()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        await using var db = new AuthDbContext(database.Options<AuthDbContext>(), new NoOpDispatcher());
        await db.Database.EnsureCreatedAsync();
        var row = await SeedOutbox(db);
        await VerifyCurrentModel(db);
        await db.Database.ExecuteSqlRawAsync("""
            ALTER TABLE public."UserRoles" DROP CONSTRAINT "FK_UserRoles_Users_UserId";
            ALTER TABLE public."UserRoles" ADD CONSTRAINT "FK_UserRoles_Users_UserId"
                FOREIGN KEY ("UserId") REFERENCES public."Users" ("Id") ON DELETE RESTRICT;
            """);
        var beforeVerification = await OutboxFingerprint(db, row.Id);

        var error = await Assert.ThrowsAsync<DatabaseSchemaCompatibilityException>(() => VerifyCurrentModel(db));

        AssertGuardMessage(error, "foreign key FK_UserRoles_Users_UserId");
        Assert.Equal(beforeVerification, await OutboxFingerprint(db, row.Id));
        Assert.False(await HistoryExists(db));
    }

    [PostgresFact]
    public async Task ChangedUniqueIndexNullSemantics_IsRejected_WithoutChangingRowsOrHistory()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        await using var db = new AuthDbContext(database.Options<AuthDbContext>(), new NoOpDispatcher());
        await db.Database.EnsureCreatedAsync();
        var row = await SeedOutbox(db);
        await VerifyCurrentModel(db);
        await db.Database.ExecuteSqlRawAsync("""
            DROP INDEX public."IX_Roles_Name";
            CREATE UNIQUE INDEX "IX_Roles_Name" ON public."Roles" ("Name") NULLS NOT DISTINCT;
            """);
        var beforeVerification = await OutboxFingerprint(db, row.Id);

        var error = await Assert.ThrowsAsync<DatabaseSchemaCompatibilityException>(() => VerifyCurrentModel(db));

        AssertGuardMessage(error, "index IX_Roles_Name");
        Assert.Equal(beforeVerification, await OutboxFingerprint(db, row.Id));
        Assert.False(await HistoryExists(db));
    }

    private static (string Sql, string Message) DriftDefinition(string drift) => drift switch
    {
        "partial-index-predicate" => ("""
            DROP INDEX public.ix_outbox_messages_active;
            CREATE INDEX ix_outbox_messages_active ON public."OutboxMessages" ("Status", "NextRetryUtc", "OccurredOnUtc")
                WHERE "Status" IN ('Pending','Processed');
            """, "index ix_outbox_messages_active"),
        "index-uniqueness" => ("""
            DROP INDEX public.ix_outbox_messages_active;
            CREATE UNIQUE INDEX ix_outbox_messages_active ON public."OutboxMessages" ("Status", "NextRetryUtc", "OccurredOnUtc")
                WHERE "Status" IN ('Pending','Failed');
            """, "index ix_outbox_messages_active"),
        "index-sort-direction" => ("""
            DROP INDEX public.ix_outbox_messages_active;
            CREATE INDEX ix_outbox_messages_active ON public."OutboxMessages" ("Status" DESC, "NextRetryUtc", "OccurredOnUtc")
                WHERE "Status" IN ('Pending','Failed');
            """, "index ix_outbox_messages_active"),
        "index-method" => ("""
            DROP INDEX public.ix_outbox_messages_active;
            CREATE INDEX ix_outbox_messages_active ON public."OutboxMessages" USING brin ("Status", "NextRetryUtc", "OccurredOnUtc")
                WHERE "Status" IN ('Pending','Failed');
            """, "index ix_outbox_messages_active"),
        "index-operator-class" => ("""
            DROP INDEX public.ix_outbox_messages_active;
            CREATE INDEX ix_outbox_messages_active ON public."OutboxMessages" ("Status" text_pattern_ops, "NextRetryUtc", "OccurredOnUtc")
                WHERE "Status" IN ('Pending','Failed');
            """, "index ix_outbox_messages_active"),
        "column-type" => ("""
            ALTER TABLE public."OutboxMessages" ALTER COLUMN "Type" TYPE varchar(256);
            """, "column OutboxMessages.Type"),
        "column-nullability" => ("""
            ALTER TABLE public."OutboxMessages" ALTER COLUMN "Type" DROP NOT NULL;
            """, "column OutboxMessages.Type"),
        "column-default" => ("""
            ALTER TABLE public."OutboxMessages" ALTER COLUMN "RetryCount" SET DEFAULT 7;
            """, "column OutboxMessages.RetryCount"),
        "missing-column" => ("""
            ALTER TABLE public."OutboxMessages" DROP COLUMN "Error";
            """, "columns"),
        "unexpected-column" => ("""
            ALTER TABLE public."OutboxMessages" ADD COLUMN "UnreviewedFlag" integer NOT NULL DEFAULT 0;
            """, "columns"),
        "missing-primary-key" => ("""
            ALTER TABLE public."OutboxMessages" DROP CONSTRAINT "PK_OutboxMessages";
            """, "indexes"),
        "unexpected-check-constraint" => ("""
            ALTER TABLE public."OutboxMessages" ADD CONSTRAINT audit_nonnegative_retry CHECK ("RetryCount" >= 0);
            """, "constraints"),
        "unexpected-table" => ("""
            CREATE TABLE public.unreviewed_schema_fixture (id integer NOT NULL);
            """, "table set"),
        "row-level-security" => ("""
            ALTER TABLE public."OutboxMessages" ENABLE ROW LEVEL SECURITY;
            """, "security"),
        _ => throw new ArgumentException("Unknown catalog drift fixture", nameof(drift))
    };

    private static DbContext Context(string service, TemporaryDatabase database) => service switch
    {
        "auth" => new AuthDbContext(database.Options<AuthDbContext>(), new NoOpDispatcher()),
        "category" => new CategoryDbContext(database.Options<CategoryDbContext>(), new NoOpDispatcher()),
        "collaboration" => new CollaborationDbContext(database.Options<CollaborationDbContext>()),
        "messaging" => new MessagingDbContext(database.Options<MessagingDbContext>()),
        _ => throw new ArgumentException("Unknown schema fixture service", nameof(service))
    };

    private static Task VerifyCurrentModel(DbContext db) =>
        PostgreSqlSchemaCompatibility.VerifyAsync(db, db.GetService<IDesignTimeModel>().Model);

    private static async Task<OutboxMessage> SeedOutbox(DbContext db)
    {
        var row = new OutboxMessage("synthetic-schema-drift-fixture", "{}", DateTime.UtcNow);
        db.Set<OutboxMessage>().Add(row);
        await db.SaveChangesAsync();
        return row;
    }

    private static Task<string> OutboxFingerprint(DbContext db, Guid rowId)
    {
        var sql = db is CollaborationDbContext
            ? "SELECT xmin::text || ':' || \"Content\" AS \"Value\" FROM collaboration.\"OutboxMessages\" WHERE \"Id\" = {0}"
            : "SELECT xmin::text || ':' || \"Content\" AS \"Value\" FROM public.\"OutboxMessages\" WHERE \"Id\" = {0}";
        return db.Database.SqlQueryRaw<string>(sql, rowId).SingleAsync();
    }

    private static Task<bool> HistoryExists(DbContext db) => db.Database.SqlQueryRaw<bool>("""
        SELECT pg_catalog.to_regclass('public."__EFMigrationsHistory"') IS NOT NULL AS "Value"
        """).SingleAsync();

    private static void AssertGuardMessage(DatabaseSchemaCompatibilityException error, string metadata)
    {
        Assert.StartsWith("Database schema is incompatible:", error.Message);
        Assert.Contains(metadata, error.Message, StringComparison.OrdinalIgnoreCase);
    }

    private sealed class NoOpDispatcher : IDomainEventDispatcher
    {
        public Task DispatchAsync(IDomainEvent domainEvent, CancellationToken cancellationToken = default) => Task.CompletedTask;
        public Task DispatchAsync(IEnumerable<IDomainEvent> domainEvents, CancellationToken cancellationToken = default) => Task.CompletedTask;
    }
}
