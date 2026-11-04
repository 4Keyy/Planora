using System.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.Logging.Abstractions;
using Planora.Auth.Domain.Entities;
using Planora.Auth.Domain.ValueObjects;
using Planora.Auth.Infrastructure.Persistence;
using Planora.BuildingBlocks.Application.Messaging;
using Planora.BuildingBlocks.Application.Outbox;
using Planora.BuildingBlocks.Domain.Interfaces;
using Planora.BuildingBlocks.Infrastructure.Persistence;
using Planora.Category.Infrastructure.Persistence;
using Planora.Collaboration.Infrastructure.Persistence;
using Planora.Collaboration.Domain.Entities;
using Planora.Messaging.Infrastructure.Persistence;
using Planora.UnitTests.BuildingBlocks.Retention.Postgres;

namespace Planora.UnitTests.Services.Infrastructure;

public sealed class VersionedDatabaseStartupPostgresTests
{
    [VersionedPostgresTheory]
    [InlineData("auth")]
    [InlineData("category")]
    [InlineData("collaboration")]
    [InlineData("messaging")]
    public async Task FreshStartup_CreatesAndRecordsReviewedChain_AndRerunPreservesRows(string service)
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        await using var db = Context(service, database);
        await Start(db);
        var known = db.Database.GetMigrations().ToArray();
        var applied = (await db.Database.GetAppliedMigrationsAsync()).ToArray();
        Assert.NotEmpty(known);
        Assert.Equal(known, applied);
        var row = new OutboxMessage("synthetic-schema-fixture", "{}", DateTime.UtcNow);
        db.Set<OutboxMessage>().Add(row);
        await db.SaveChangesAsync();
        await Start(db);
        Assert.Equal(applied, (await db.Database.GetAppliedMigrationsAsync()).ToArray());
        Assert.Equal(row.Content, (await db.Set<OutboxMessage>().AsNoTracking().SingleAsync(item => item.Id == row.Id)).Content);
    }

    [VersionedPostgresTheory]
    [InlineData("auth")]
    [InlineData("category")]
    [InlineData("collaboration")]
    [InlineData("messaging")]
    public async Task CompatibleUnmanagedSchema_IsAdopted_WithoutRecreatingStoredRows(string service)
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        await using var db = Context(service, database);
        await db.Database.EnsureCreatedAsync();
        var row = new OutboxMessage("synthetic-adoption-fixture", "{}", DateTime.UtcNow);
        db.Set<OutboxMessage>().Add(row);
        await db.SaveChangesAsync();
        var before = await Fingerprint(db, row.Id);
        await Start(db);
        Assert.NotEmpty(await db.Database.GetAppliedMigrationsAsync());
        Assert.Equal(before, await Fingerprint(db, row.Id));
    }

    [VersionedPostgresTheory]
    [InlineData("auth")]
    [InlineData("category")]
    [InlineData("collaboration")]
    [InlineData("messaging")]
    public async Task UnknownHistory_IsRejected_WithoutChangingItsRows(string service)
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        await using var db = Context(service, database);
        await db.Database.EnsureCreatedAsync();
        await db.Database.ExecuteSqlRawAsync("""
            CREATE TABLE public."__EFMigrationsHistory" ("MigrationId" varchar(150) NOT NULL PRIMARY KEY, "ProductVersion" varchar(32) NOT NULL);
            INSERT INTO public."__EFMigrationsHistory" VALUES ('20990101000000_UnknownFixture', '10.0.8');
            """);
        await Assert.ThrowsAnyAsync<InvalidOperationException>(() => Start(db));
        Assert.Equal(new[] { "20990101000000_UnknownFixture" }, (await db.Database.GetAppliedMigrationsAsync()).ToArray());
    }

    [VersionedPostgresTheory]
    [InlineData("auth")]
    [InlineData("category")]
    [InlineData("collaboration")]
    [InlineData("messaging")]
    public async Task PartialUnmanagedSchema_IsRejected_WithoutStampingHistory(string service)
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        await using var db = Context(service, database);
        await db.Database.ExecuteSqlRawAsync("CREATE TABLE public.unexpected_fixture (id integer NOT NULL)");
        await Assert.ThrowsAnyAsync<InvalidOperationException>(() => Start(db));
        Assert.Empty(await db.Database.GetAppliedMigrationsAsync());
        Assert.True(await db.Database.SqlQueryRaw<bool>(
            "SELECT to_regclass('public.unexpected_fixture') IS NOT NULL AS \"Value\"").SingleAsync());
    }

    [VersionedPostgresTheory]
    [InlineData("auth")]
    [InlineData("category")]
    [InlineData("collaboration")]
    [InlineData("messaging")]
    public async Task CanceledStartup_DoesNotCreateSchema(string service)
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        await using var db = Context(service, database);
        using var canceled = new CancellationTokenSource();
        canceled.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => Start(db, canceled.Token));
        Assert.Equal(0, await db.Database.SqlQueryRaw<int>("""
            SELECT COUNT(*)::integer AS "Value" FROM pg_catalog.pg_tables
            WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
            """).SingleAsync());
    }

    [VersionedPostgresTheory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task PreReplySchema_UpgradesWithoutRewritingComments(bool managed)
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        await using var current = new CollaborationDbContext(database.Options<CollaborationDbContext>());
        await using var legacy = LegacyCollaborationBaselineFactory.Create(database.Options<CollaborationDbContext>());
        if (managed)
            await current.GetService<IMigrator>().MigrateAsync(CollaborationDatabaseStartup.BaselineMigrationId);
        else
            Assert.True(await legacy.Database.EnsureCreatedAsync());

        var comment = Comment.Create(Guid.NewGuid(), Guid.NewGuid(), "Synthetic author", "Existing comment before reply support");
        legacy.Comments.Add(comment);
        await legacy.SaveChangesAsync();
        var before = await CommentFingerprint(legacy, comment.Id);

        await Start(current);
        Assert.Equal(current.Database.GetMigrations(), await current.Database.GetAppliedMigrationsAsync());
        var saved = await current.Comments.AsNoTracking().SingleAsync(item => item.Id == comment.Id);
        Assert.Equal(comment.Content, saved.Content);
        Assert.Equal(comment.AuthorId, saved.AuthorId);
        Assert.Equal(comment.TaskId, saved.TaskId);
        Assert.Null(saved.ReplyToId);
        Assert.Null(saved.ReplyToType);
        Assert.False(saved.ReplyToDeleted);
        Assert.Equal(before, await CommentFingerprint(current, comment.Id));
        await Start(current);
        Assert.Equal(before, await CommentFingerprint(current, comment.Id));
    }

    [PostgresFact]
    public async Task PartiallyAddedReplyColumns_DoNotQualifyForEitherBaseline()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        await using var legacy = LegacyCollaborationBaselineFactory.Create(database.Options<CollaborationDbContext>());
        await legacy.Database.EnsureCreatedAsync();
        await legacy.Database.ExecuteSqlRawAsync("ALTER TABLE collaboration.comments ADD COLUMN \"ReplyToId\" uuid");
        await using var current = new CollaborationDbContext(database.Options<CollaborationDbContext>());
        await Assert.ThrowsAsync<DatabaseSchemaCompatibilityException>(() => Start(current));
        Assert.Empty(await current.Database.GetAppliedMigrationsAsync());
        Assert.Equal(1, await current.Database.SqlQueryRaw<int>("""
            SELECT COUNT(*)::integer AS "Value" FROM information_schema.columns
            WHERE table_schema='collaboration' AND table_name='comments' AND column_name LIKE 'ReplyTo%'
            """).SingleAsync());
    }

    [PostgresFact]
    public async Task LaterKnownHistoryWithoutBaseline_IsRejected()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        await using var db = new CollaborationDbContext(database.Options<CollaborationDbContext>());
        await db.Database.EnsureCreatedAsync();
        var history = db.GetService<IHistoryRepository>();
        await db.Database.ExecuteSqlRawAsync(history.GetCreateIfNotExistsScript());
        var onlyLater = CollaborationDatabaseStartup.ReplyReferencesMigrationId;
        await db.Database.ExecuteSqlRawAsync(history.GetInsertScript(new HistoryRow(onlyLater, ProductInfo.GetVersion())));
        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => Start(db));
        Assert.Contains("chronological prefix", error.Message, StringComparison.Ordinal);
        Assert.Equal(new[] { onlyLater }, (await db.Database.GetAppliedMigrationsAsync()).ToArray());
    }

    [PostgresFact]
    public async Task AuthAdoption_PreservesExistingRoleIdentityAndForeignKey()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        await using var db = new AuthDbContext(database.Options<AuthDbContext>(), new NoOpDispatcher());
        await db.Database.EnsureCreatedAsync();
        var roleId = Guid.NewGuid();
        await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE public.\"Roles\" SET \"Id\"={roleId} WHERE \"Name\"='Admin'");
        var user = User.Create(Email.Create("schema-fixture@example.invalid"), "synthetic-hash", "Schema", "Fixture");
        var membership = UserRole.Create(user.Id, roleId);
        db.Users.Add(user);
        db.UserRoles.Add(membership);
        await db.SaveChangesAsync();
        var sql = "SELECT xmin::text AS \"Value\" FROM public.\"UserRoles\" WHERE \"Id\"={0}";
        var before = await db.Database.SqlQueryRaw<string>(sql, membership.Id).SingleAsync();

        await Start(db);

        Assert.Equal(roleId, (await db.Roles.AsNoTracking().SingleAsync(role => role.Name == "Admin")).Id);
        Assert.Equal(roleId, (await db.UserRoles.AsNoTracking().SingleAsync(role => role.Id == membership.Id)).RoleId);
        Assert.Equal(before, await db.Database.SqlQueryRaw<string>(sql, membership.Id).SingleAsync());
        Assert.Equal(2, await db.Roles.CountAsync());
    }

    [PostgresFact]
    public async Task ConcurrentPreparation_RecordsOneHistoryAndPreservesExistingRows()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        await using var first = Context("category", database);
        await using var second = Context("category", database);
        await first.Database.EnsureCreatedAsync();
        var row = new OutboxMessage("synthetic-concurrent-adoption", "{}", DateTime.UtcNow);
        first.Set<OutboxMessage>().Add(row);
        await first.SaveChangesAsync();
        var before = await Fingerprint(first, row.Id);

        await Task.WhenAll(Start(first), Start(second)).WaitAsync(TimeSpan.FromSeconds(30));

        Assert.Single(await first.Database.GetAppliedMigrationsAsync());
        Assert.Equal(before, await Fingerprint(first, row.Id));
    }

    [PostgresFact]
    public async Task CancellationWhileWaitingForPreparationLock_RestoresCallerSession()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        await using var holder = Context("category", database);
        await using var waiting = Context("category", database);
        await holder.Database.OpenConnectionAsync();
        await waiting.Database.OpenConnectionAsync();
        await waiting.Database.ExecuteSqlRawAsync("SET search_path TO public, pg_catalog");
        await holder.Database.ExecuteSqlRawAsync("SELECT pg_catalog.pg_advisory_lock(742810634::bigint)");
        using var cancellation = new CancellationTokenSource(TimeSpan.FromSeconds(12));
        var preparation = Start(waiting, cancellation.Token);
        try
        {
            var deadline = DateTime.UtcNow.AddSeconds(5);
            var blocked = false;
            while (!blocked && DateTime.UtcNow < deadline)
            {
                blocked = await holder.Database.SqlQueryRaw<bool>("""
                    SELECT EXISTS(SELECT 1 FROM pg_catalog.pg_locks
                        WHERE locktype='advisory' AND database=(SELECT oid FROM pg_catalog.pg_database WHERE datname=pg_catalog.current_database())
                          AND classid=0::oid AND objid=742810634::oid AND objsubid=1 AND NOT granted) AS "Value"
                    """).SingleAsync();
                if (!blocked) await Task.Delay(30);
            }
            Assert.True(blocked);
            cancellation.Cancel();
            await Assert.ThrowsAnyAsync<OperationCanceledException>(() => preparation);
            Assert.Equal(ConnectionState.Open, waiting.Database.GetDbConnection().State);
            Assert.Equal("public, pg_catalog", await waiting.Database.SqlQueryRaw<string>(
                "SELECT pg_catalog.current_setting('search_path') AS \"Value\"").SingleAsync());
            Assert.Empty(await waiting.Database.GetAppliedMigrationsAsync());
        }
        finally
        {
            cancellation.Cancel();
            await holder.Database.ExecuteSqlRawAsync("SELECT pg_catalog.pg_advisory_unlock(742810634::bigint)");
        }
        await Start(waiting);
        Assert.Single(await waiting.Database.GetAppliedMigrationsAsync());
    }

    [PostgresFact]
    public async Task PreparationWithCallerHeldLock_RejectsAndLeavesCallerHoldIntact()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        await using var db = Context("category", database);
        await db.Database.OpenConnectionAsync();
        await db.Database.ExecuteSqlRawAsync("SET search_path TO public, pg_catalog");
        await db.Database.ExecuteSqlRawAsync("SELECT pg_catalog.pg_advisory_lock(742810634::bigint)");

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => Start(db));

        Assert.Contains("already holds", error.Message, StringComparison.Ordinal);
        Assert.Equal(ConnectionState.Open, db.Database.GetDbConnection().State);
        Assert.Equal("public, pg_catalog", await db.Database.SqlQueryRaw<string>(
            "SELECT pg_catalog.current_setting('search_path') AS \"Value\"").SingleAsync());
        Assert.True(await db.Database.SqlQueryRaw<bool>(
            "SELECT pg_catalog.pg_advisory_unlock(742810634::bigint) AS \"Value\"").SingleAsync());
        Assert.Empty(await db.Database.GetAppliedMigrationsAsync());
    }

    private static Task Start(DbContext db, CancellationToken cancellationToken = default) => db switch
    {
        AuthDbContext context => AuthDatabaseStartup.EnsureReadyAsync(context, NullLogger.Instance, cancellationToken),
        CategoryDbContext context => CategoryDatabaseStartup.EnsureReadyAsync(context, NullLogger.Instance, cancellationToken),
        CollaborationDbContext context => CollaborationDatabaseStartup.EnsureReadyAsync(context, NullLogger.Instance, cancellationToken),
        MessagingDbContext context => MessagingDatabaseStartup.EnsureReadyAsync(context, NullLogger.Instance, cancellationToken),
        _ => throw new ArgumentException("Unknown test context", nameof(db))
    };

    private static DbContext Context(string service, TemporaryDatabase database) => service switch
    {
        "auth" => new AuthDbContext(database.Options<AuthDbContext>(), new NoOpDispatcher()),
        "category" => new CategoryDbContext(database.Options<CategoryDbContext>(), new NoOpDispatcher()),
        "collaboration" => new CollaborationDbContext(database.Options<CollaborationDbContext>()),
        "messaging" => new MessagingDbContext(database.Options<MessagingDbContext>()),
        _ => throw new ArgumentException("Unknown test service", nameof(service))
    };

    private static async Task<string> Fingerprint(DbContext db, Guid rowId)
    {
        var sql = db is CollaborationDbContext
            ? "SELECT xmin::text AS \"Value\" FROM collaboration.\"OutboxMessages\" WHERE \"Id\" = {0}"
            : "SELECT xmin::text AS \"Value\" FROM public.\"OutboxMessages\" WHERE \"Id\" = {0}";
        return await db.Database.SqlQueryRaw<string>(sql, rowId).SingleAsync();
    }

    private static Task<string> CommentFingerprint(DbContext db, Guid rowId) => db.Database.SqlQueryRaw<string>(
        "SELECT xmin::text AS \"Value\" FROM collaboration.comments WHERE \"Id\"={0}", rowId).SingleAsync();

    private sealed class NoOpDispatcher : IDomainEventDispatcher
    {
        public Task DispatchAsync(IDomainEvent domainEvent, CancellationToken cancellationToken = default) => Task.CompletedTask;
        public Task DispatchAsync(IEnumerable<IDomainEvent> domainEvents, CancellationToken cancellationToken = default) => Task.CompletedTask;
    }
}

public sealed class VersionedPostgresTheoryAttribute : TheoryAttribute
{
    public VersionedPostgresTheoryAttribute()
    {
        if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable(PostgresFactAttribute.Variable)))
            Skip = "Requires an explicitly verified disposable PostgreSQL server";
    }
}
