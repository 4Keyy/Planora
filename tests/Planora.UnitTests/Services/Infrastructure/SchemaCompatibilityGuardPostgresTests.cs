using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Metadata;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.Logging.Abstractions;
using Planora.Auth.Infrastructure.Persistence;
using Planora.BuildingBlocks.Application.Messaging;
using Planora.BuildingBlocks.Application.Outbox;
using Planora.BuildingBlocks.Domain.Interfaces;
using Planora.BuildingBlocks.Infrastructure.Persistence;
using Planora.Category.Infrastructure.Persistence;
using Planora.UnitTests.BuildingBlocks.Retention.Postgres;

namespace Planora.UnitTests.Services.Infrastructure;

public sealed class SchemaCompatibilityGuardPostgresTests
{
    [PostgresFact]
    public async Task ValidCategorySchema_IsVerifiedAndAdopted_WithoutChangingStoredRows()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        await using var db = Category(database);
        Assert.True(await db.Database.EnsureCreatedAsync());
        var row = await SeedOutbox(db);
        var before = await Fingerprint(db, row.Id);

        await VerifyCurrentModel(db);
        await Prepare(db);

        Assert.Equal(db.Database.GetMigrations(), await db.Database.GetAppliedMigrationsAsync());
        Assert.Equal(before, await Fingerprint(db, row.Id));
        Assert.Equal(1, await db.OutboxMessages.AsNoTracking().CountAsync());
    }

    [PostgresFact]
    public async Task HistoryInsertTrigger_IsRejectedBeforeAdoption_AndCannotDeleteExistingOutboxRows()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        await using var db = Category(database);
        await db.Database.EnsureCreatedAsync();
        var row = await SeedOutbox(db);
        var before = await Fingerprint(db, row.Id);
        await db.Database.ExecuteSqlRawAsync(db.GetService<IHistoryRepository>().GetCreateIfNotExistsScript());
        await db.Database.ExecuteSqlRawAsync("""
            CREATE FUNCTION public.audit_history_insert() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                DELETE FROM public."OutboxMessages";
                RETURN NEW;
            END $$;
            CREATE TRIGGER audit_history_insert AFTER INSERT ON public."__EFMigrationsHistory"
                FOR EACH ROW EXECUTE FUNCTION public.audit_history_insert();
            """);

        var error = await Assert.ThrowsAsync<DatabaseSchemaCompatibilityException>(() => Prepare(db));

        AssertGuardMessage(error, "__EFMigrationsHistory");
        Assert.Contains("trigger", error.Message, StringComparison.OrdinalIgnoreCase);
        Assert.Equal(0, await db.Database.SqlQueryRaw<int>(
            "SELECT COUNT(*)::integer AS \"Value\" FROM public.\"__EFMigrationsHistory\"").SingleAsync());
        Assert.Equal(before, await Fingerprint(db, row.Id));
        Assert.Equal(1, await db.OutboxMessages.AsNoTracking().CountAsync());
    }

    [PostgresFact]
    public async Task HistoryView_IsRejectedBeforeReadingItsVolatileFunction()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        await using var db = Category(database);
        await db.Database.EnsureCreatedAsync();
        var row = await SeedOutbox(db);
        var before = await Fingerprint(db, row.Id);
        var baseline = Baseline(db);
        Assert.Matches(@"\A[0-9]{14}_[A-Za-z0-9_]+\z", baseline);
        // The migration ID is compiled metadata with the restricted shape asserted above.
        var historyViewSql = $"""
            CREATE SEQUENCE public.audit_history_reads;
            CREATE FUNCTION public.audit_history_id() RETURNS varchar(150) LANGUAGE plpgsql VOLATILE AS $$
            BEGIN
                PERFORM pg_catalog.nextval('public.audit_history_reads');
                RETURN '{baseline}';
            END $$;
            CREATE VIEW public."__EFMigrationsHistory" AS
                SELECT public.audit_history_id() AS "MigrationId", '10.0.8'::varchar(32) AS "ProductVersion";
            """;
        await db.Database.ExecuteSqlRawAsync(historyViewSql);
        Assert.False(await HistoryReadProbeWasCalled(db));

        var error = await Assert.ThrowsAsync<DatabaseSchemaCompatibilityException>(() => Prepare(db));

        AssertGuardMessage(error, "__EFMigrationsHistory");
        Assert.False(await HistoryReadProbeWasCalled(db));
        Assert.Equal(before, await Fingerprint(db, row.Id));
        Assert.Equal("v", await db.Database.SqlQueryRaw<string>("""
            SELECT c.relkind::text AS "Value" FROM pg_catalog.pg_class c
            JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
            WHERE n.nspname='public' AND c.relname='__EFMigrationsHistory'
            """).SingleAsync());
    }

    [PostgresFact]
    public async Task EnabledDatabaseEventTrigger_IsRejectedBeforeAnyHistoryDdlExecutes()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        await using var db = Category(database);
        await db.Database.EnsureCreatedAsync();
        var row = await SeedOutbox(db);
        var before = await Fingerprint(db, row.Id);
        await db.Database.ExecuteSqlRawAsync("""
            CREATE SEQUENCE public.audit_event_calls;
            CREATE FUNCTION public.audit_on_ddl() RETURNS event_trigger LANGUAGE plpgsql AS $$
            BEGIN
                PERFORM pg_catalog.nextval('public.audit_event_calls');
            END $$;
            CREATE EVENT TRIGGER audit_on_ddl ON ddl_command_start EXECUTE FUNCTION public.audit_on_ddl();
            """);
        Assert.False(await EventProbeWasCalled(db));

        var error = await Assert.ThrowsAsync<DatabaseSchemaCompatibilityException>(() => Prepare(db));

        AssertGuardMessage(error, "event trigger");
        Assert.False(await EventProbeWasCalled(db));
        Assert.False(await HistoryExists(db));
        Assert.Equal(before, await Fingerprint(db, row.Id));
    }

    [PostgresFact]
    public async Task ShadowedNowDefault_IsRejected_EvenWhenPostgresRendersTheSameUnqualifiedText()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        await using var db = new AuthDbContext(database.Options<AuthDbContext>(), new NoOpDispatcher());
        await db.Database.EnsureCreatedAsync();
        var row = await SeedOutbox(db);
        var before = await Fingerprint(db, row.Id);
        // Pin this disposable connection so the adversarial search_path cannot disappear between commands.
        await db.Database.OpenConnectionAsync();
        await db.Database.ExecuteSqlRawAsync("""
            CREATE FUNCTION public.now() RETURNS timestamp with time zone LANGUAGE sql VOLATILE AS $$
                SELECT TIMESTAMPTZ '2001-01-01 00:00:00+00'
            $$;
            ALTER TABLE public."RefreshTokens" ALTER COLUMN "LastLoginAt" SET DEFAULT public.now();
            SET search_path TO public, pg_catalog;
            """);
        var rendered = await db.Database.SqlQueryRaw<string>("""
            SELECT pg_catalog.pg_get_expr(d.adbin,d.adrelid) AS "Value"
            FROM pg_catalog.pg_attrdef d
            JOIN pg_catalog.pg_attribute a ON a.attrelid=d.adrelid AND a.attnum=d.adnum
            JOIN pg_catalog.pg_class c ON c.oid=a.attrelid
            JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
            WHERE n.nspname='public' AND c.relname='RefreshTokens' AND a.attname='LastLoginAt'
            """).SingleAsync();
        Assert.Equal("now()", rendered);

        var error = await Assert.ThrowsAsync<DatabaseSchemaCompatibilityException>(() => VerifyCurrentModel(db));

        AssertGuardMessage(error, "default");
        Assert.Equal(before, await Fingerprint(db, row.Id));
        Assert.False(await HistoryExists(db));
    }

    [PostgresFact]
    public async Task UserCollationNamedDefault_IsRejectedAsDifferentFromTheSystemDefault()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        await using var db = Category(database);
        await db.Database.EnsureCreatedAsync();
        var row = await SeedOutbox(db);
        var before = await Fingerprint(db, row.Id);
        await db.Database.ExecuteSqlRawAsync("""
            CREATE COLLATION public."default" FROM pg_catalog."C";
            ALTER TABLE public."Categories" ALTER COLUMN "Name" TYPE varchar(50) COLLATE public."default";
            """);
        Assert.Equal("public.default", await db.Database.SqlQueryRaw<string>("""
            SELECT ns.nspname || '.' || coll.collname AS "Value"
            FROM pg_catalog.pg_attribute a
            JOIN pg_catalog.pg_class c ON c.oid=a.attrelid
            JOIN pg_catalog.pg_namespace table_ns ON table_ns.oid=c.relnamespace
            JOIN pg_catalog.pg_collation coll ON coll.oid=a.attcollation
            JOIN pg_catalog.pg_namespace ns ON ns.oid=coll.collnamespace
            WHERE table_ns.nspname='public' AND c.relname='Categories' AND a.attname='Name'
            """).SingleAsync());

        var error = await Assert.ThrowsAsync<DatabaseSchemaCompatibilityException>(() => Prepare(db));

        AssertGuardMessage(error, "collation");
        Assert.False(await HistoryExists(db));
        Assert.Equal(before, await Fingerprint(db, row.Id));
    }

    [PostgresFact]
    public async Task StatusOperandCoercion_IsRejectedBeforeStampingHistory()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        await using var db = Category(database);
        await db.Database.EnsureCreatedAsync();
        Assert.Equal(0, await db.OutboxMessages.CountAsync());
        // An empty table permits this index to be created; a Pending row would fail its integer coercion.
        await db.Database.ExecuteSqlRawAsync("""
            DROP INDEX public.ix_outbox_messages_active;
            CREATE INDEX ix_outbox_messages_active ON public."OutboxMessages" ("Status", "NextRetryUtc", "OccurredOnUtc")
                WHERE (("Status"::integer)::text) IN ('Pending','Failed');
            """);

        var error = await Assert.ThrowsAsync<DatabaseSchemaCompatibilityException>(() => Prepare(db));

        AssertGuardMessage(error, "index");
        Assert.False(await HistoryExists(db));
        Assert.Equal(0, await db.OutboxMessages.CountAsync());
    }

    private static CategoryDbContext Category(TemporaryDatabase database) =>
        new(database.Options<CategoryDbContext>(), new NoOpDispatcher());

    private static string Baseline(DbContext db) => db.Database.GetMigrations().First();

    private static Task Prepare(DbContext db) =>
        VersionedDatabaseStartup.EnsureReadyAsync(db, Baseline(db), NullLogger.Instance);

    private static Task VerifyCurrentModel(DbContext db) =>
        PostgreSqlSchemaCompatibility.VerifyAsync(db, db.GetService<IDesignTimeModel>().Model);

    private static async Task<OutboxMessage> SeedOutbox(DbContext db)
    {
        var row = new OutboxMessage("synthetic-schema-security-fixture", "{}", DateTime.UtcNow);
        db.Set<OutboxMessage>().Add(row);
        await db.SaveChangesAsync();
        return row;
    }

    private static Task<string> Fingerprint(DbContext db, Guid rowId) =>
        db.Database.SqlQueryRaw<string>(
            "SELECT xmin::text AS \"Value\" FROM public.\"OutboxMessages\" WHERE \"Id\" = {0}", rowId).SingleAsync();

    private static Task<bool> HistoryExists(DbContext db) => db.Database.SqlQueryRaw<bool>("""
        SELECT pg_catalog.to_regclass('public."__EFMigrationsHistory"') IS NOT NULL AS "Value"
        """).SingleAsync();

    // Sequence state is not rolled back, so even a subsequently aborted transaction cannot hide function execution.
    private static Task<bool> HistoryReadProbeWasCalled(DbContext db) =>
        db.Database.SqlQueryRaw<bool>("SELECT is_called AS \"Value\" FROM public.audit_history_reads").SingleAsync();

    private static Task<bool> EventProbeWasCalled(DbContext db) =>
        db.Database.SqlQueryRaw<bool>("SELECT is_called AS \"Value\" FROM public.audit_event_calls").SingleAsync();

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
