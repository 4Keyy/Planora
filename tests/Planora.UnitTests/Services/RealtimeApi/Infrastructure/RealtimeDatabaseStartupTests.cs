using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Npgsql;
using Planora.BuildingBlocks.Application.Messaging;
using Planora.Realtime.Domain.Entities;
using Planora.Realtime.Infrastructure.Persistence;
using Planora.UnitTests.BuildingBlocks.Retention.Postgres;

namespace Planora.UnitTests.Services.RealtimeApi.Infrastructure;

/// <summary>Startup must prepare a fresh log without destroying an existing untracked schema.</summary>
[Trait("TestType", "Integration")]
public sealed class RealtimeDatabaseStartupTests
{
    [Fact]
    public async Task UnconfiguredLog_AndNonRelationalTestContext_RemainOptional()
    {
        await RealtimeDatabaseStartup.EnsureReadyAsync(null, NullLogger.Instance, CancellationToken.None);
        await using var db = new RealtimeDbContext(
            new DbContextOptionsBuilder<RealtimeDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options,
            Mock.Of<IDomainEventDispatcher>());
        await RealtimeDatabaseStartup.EnsureReadyAsync(db, NullLogger.Instance, CancellationToken.None);
    }

    [PostgresFact]
    public async Task MissingDatabase_IsCreatedAndMigratedBeforeTheFirstNotification()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        var server = new NpgsqlConnectionStringBuilder(database.ConnectionString) { Database = "postgres" };
        await using (var connection = new NpgsqlConnection(server.ConnectionString))
        {
            await connection.OpenAsync();
            await using var drop = new NpgsqlCommand($"DROP DATABASE \"{database.Name}\"", connection);
            await drop.ExecuteNonQueryAsync();
        }

        await using var db = NewContext(database);
        await Start(db);
        Assert.True(await db.Database.CanConnectAsync(), "Startup creates the configured database.");
        db.Notifications.Add(Arrived());
        await db.SaveChangesAsync();
        Assert.Equal(1, await db.Notifications.CountAsync());
        Assert.Equal(db.Database.GetMigrations(), await db.Database.GetAppliedMigrationsAsync());
    }

    [PostgresFact]
    public async Task ManagedSchema_RestartIsIdempotentAndPreservesData()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        await using var db = NewContext(database);
        await db.Database.MigrateAsync();
        var notification = Arrived();
        db.Notifications.Add(notification);
        await db.SaveChangesAsync();

        await Start(db);
        await Start(db);
        Assert.Equal(notification.Id, (await db.Notifications.SingleAsync()).Id);
        Assert.Equal(db.Database.GetMigrations(), await db.Database.GetAppliedMigrationsAsync());
    }

    [PostgresFact]
    public async Task CompatibleModelCreatedSchema_PreservesDataWithoutAdoptingMigrationHistory()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        await using var db = NewContext(database);
        await db.Database.EnsureCreatedAsync();
        var notification = Arrived();
        db.Notifications.Add(notification);
        await db.SaveChangesAsync();

        await Start(db);
        await Start(db);
        Assert.Equal(notification.Id, (await db.Notifications.SingleAsync()).Id);
        Assert.Empty(await db.Database.GetAppliedMigrationsAsync());
        Assert.False(await RelationExists(database, "__EFMigrationsHistory"));
    }

    [PostgresFact]
    public async Task PartialUnmanagedSchema_FailsClosedWithoutRecreatingTheMissingTable()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        await using var db = NewContext(database);
        await db.Database.EnsureCreatedAsync();
        db.Notifications.Add(Arrived());
        await db.SaveChangesAsync();
        await db.Database.ExecuteSqlRawAsync("DROP TABLE \"NotificationDeliveries\"");

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => Start(db));
        Assert.Contains("NotificationDeliveries", error.Message);
        Assert.Contains("migration", error.Message, StringComparison.OrdinalIgnoreCase);
        Assert.Equal(1, await db.Notifications.CountAsync());
        Assert.False(await RelationExists(database, "NotificationDeliveries"));
        Assert.False(await RelationExists(database, "__EFMigrationsHistory"));
    }

    [PostgresFact]
    public async Task UnmanagedColumnTypeDrift_FailsClosedAndKeepsExistingRows()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        await using var db = NewContext(database);
        await db.Database.EnsureCreatedAsync();
        db.Notifications.Add(Arrived());
        await db.SaveChangesAsync();
        await db.Database.ExecuteSqlRawAsync("ALTER TABLE \"Notifications\" ALTER COLUMN \"Title\" TYPE character varying(201)");

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => Start(db));
        Assert.Contains("Notifications.Title", error.Message);
        Assert.Equal(1, await db.Notifications.CountAsync());
        Assert.Empty(await db.Database.GetAppliedMigrationsAsync());
    }

    [PostgresFact]
    public async Task UnmanagedMissingColumn_FailsClosedWithoutRepairingTheSchema()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        await using var db = NewContext(database);
        await db.Database.EnsureCreatedAsync();
        await db.Database.ExecuteSqlRawAsync("ALTER TABLE \"Notifications\" DROP COLUMN \"ReadAtUtc\"");

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => Start(db));
        Assert.Contains("Notifications.ReadAtUtc", error.Message);
        Assert.False(await RelationExists(database, "__EFMigrationsHistory"));
    }

    [PostgresFact]
    public async Task UnmanagedNullabilityDrift_FailsClosed()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        await using var db = NewContext(database);
        await db.Database.EnsureCreatedAsync();
        await db.Database.ExecuteSqlRawAsync("ALTER TABLE \"Notifications\" ALTER COLUMN \"Title\" DROP NOT NULL");

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => Start(db));
        Assert.Contains("Notifications.Title", error.Message);
        Assert.Empty(await db.Database.GetAppliedMigrationsAsync());
    }

    [PostgresFact]
    public async Task UnmanagedMissingIdempotencyKey_FailsClosed()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        await using var db = NewContext(database);
        await db.Database.EnsureCreatedAsync();
        await db.Database.ExecuteSqlRawAsync("DROP INDEX \"IX_Notifications_SourceEventId\"");

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => Start(db));
        Assert.Contains("Notifications", error.Message);
        Assert.Contains("SourceEventId", error.Message);
        Assert.Empty(await db.Database.GetAppliedMigrationsAsync());
    }

    [PostgresFact]
    public async Task BuildWithoutMigrations_CreatesAllRequiredTablesFromTheModel()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        await using var db = new RealtimeDbContext(
            new DbContextOptionsBuilder<RealtimeDbContext>()
                .UseNpgsql(database.ConnectionString, options =>
                    options.MigrationsAssembly(typeof(RealtimeDatabaseStartupTests).Assembly.FullName!))
                .Options,
            Mock.Of<IDomainEventDispatcher>());
        Assert.Empty(db.Database.GetMigrations());

        await Start(db);
        db.Notifications.Add(Arrived());
        await db.SaveChangesAsync();
        Assert.Equal(1, await db.Notifications.CountAsync());
        Assert.True(await RelationExists(database, "NotificationDeliveries"));
        Assert.True(await RelationExists(database, "OutboxMessages"));
        Assert.False(await RelationExists(database, "__EFMigrationsHistory"));
    }

    [PostgresFact]
    public async Task UnknownManagedMigration_FailsClosedAndPreservesDataAndHistory()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        await using var db = NewContext(database);
        await db.Database.MigrateAsync();
        var notification = Arrived();
        db.Notifications.Add(notification);
        await db.SaveChangesAsync();
        await db.Database.ExecuteSqlRawAsync(
            "INSERT INTO \"__EFMigrationsHistory\" (\"MigrationId\", \"ProductVersion\") VALUES ('20990101000000_UnknownRealtime', '10.0.0')");

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => Start(db));
        Assert.Contains("UnknownRealtime", error.Message);
        Assert.Equal(notification.Id, (await db.Notifications.SingleAsync()).Id);
        Assert.Contains("20990101000000_UnknownRealtime", await db.Database.GetAppliedMigrationsAsync());
    }

    [PostgresFact]
    public async Task UnmanagedMissingPrimaryKey_FailsClosed()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        await using var db = NewContext(database);
        await db.Database.EnsureCreatedAsync();
        await db.Database.ExecuteSqlRawAsync("ALTER TABLE \"Notifications\" DROP CONSTRAINT \"PK_Notifications\"");

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => Start(db));
        Assert.Contains("Notifications", error.Message);
        Assert.Contains("primary key", error.Message);
        Assert.False(await RelationExists(database, "__EFMigrationsHistory"));
    }

    [PostgresFact]
    public async Task UnmanagedRequiredExtraColumn_FailsClosedBeforeWriting()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        await using var db = NewContext(database);
        await db.Database.EnsureCreatedAsync();
        await db.Database.ExecuteSqlRawAsync("ALTER TABLE \"Notifications\" ADD COLUMN \"LegacyRequired\" text NOT NULL");

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => Start(db));
        Assert.Contains("Notifications.LegacyRequired", error.Message);
        Assert.Equal(0, await db.Notifications.CountAsync());
        Assert.False(await RelationExists(database, "__EFMigrationsHistory"));
    }

    [PostgresFact]
    public async Task UnmanagedOptionalOrGeneratedExtraColumns_RemainCompatible()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        await using var db = NewContext(database);
        await db.Database.EnsureCreatedAsync();
        await db.Database.ExecuteSqlRawAsync("""
            ALTER TABLE "Notifications" ADD COLUMN "LegacyOptional" text;
            ALTER TABLE "Notifications" ADD COLUMN "LegacyDefault" text NOT NULL DEFAULT 'legacy';
            ALTER TABLE "Notifications" ADD COLUMN "LegacyGenerated" integer GENERATED ALWAYS AS (length("Title")) STORED NOT NULL;
            ALTER TABLE "Notifications" ADD COLUMN "LegacyIdentity" bigint GENERATED ALWAYS AS IDENTITY;
            """);

        await Start(db);
        var notification = Arrived();
        db.Notifications.Add(notification);
        await db.SaveChangesAsync();
        Assert.Equal(notification.Id, (await db.Notifications.SingleAsync()).Id);
        Assert.False(await RelationExists(database, "__EFMigrationsHistory"));

        await using var connection = new NpgsqlConnection(database.ConnectionString);
        await connection.OpenAsync();
        await using var query = new NpgsqlCommand("""
            SELECT "LegacyOptional", "LegacyDefault", "LegacyGenerated", "LegacyIdentity" FROM "Notifications"
            """, connection);
        await using var reader = await query.ExecuteReaderAsync();
        Assert.True(await reader.ReadAsync());
        Assert.True(reader.IsDBNull(0));
        Assert.Equal("legacy", reader.GetString(1));
        Assert.Equal(notification.Title.Length, reader.GetInt32(2));
        Assert.True(reader.GetInt64(3) > 0);
    }

    [PostgresFact]
    public async Task Cancellation_DoesNotCreateTheSchema()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        await using var db = NewContext(database);
        using var cancelled = new CancellationTokenSource();
        cancelled.Cancel();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            RealtimeDatabaseStartup.EnsureReadyAsync(db, NullLogger.Instance, cancelled.Token));
        Assert.False(await RelationExists(database, "Notifications"));
    }

    private static RealtimeDbContext NewContext(TemporaryDatabase database) =>
        new(database.Options<RealtimeDbContext>(), Mock.Of<IDomainEventDispatcher>());

    private static Task Start(RealtimeDbContext db) =>
        RealtimeDatabaseStartup.EnsureReadyAsync(db, NullLogger.Instance, CancellationToken.None);

    private static Notification Arrived() =>
        new(Guid.NewGuid(), "Startup", "Keep this row", "TaskShared", DateTime.UtcNow, Guid.NewGuid());

    private static async Task<bool> RelationExists(TemporaryDatabase database, string name)
    {
        await using var connection = new NpgsqlConnection(database.ConnectionString);
        await connection.OpenAsync();
        await using var query = new NpgsqlCommand("SELECT to_regclass(@name) IS NOT NULL", connection);
        query.Parameters.AddWithValue("name", $"public.\"{name}\"");
        return (bool)(await query.ExecuteScalarAsync())!;
    }
}
