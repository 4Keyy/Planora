using System.Reflection;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Planora.BuildingBlocks.Infrastructure.Retention;

namespace Planora.UnitTests.BuildingBlocks.Retention.Postgres;

/// <summary>
/// A test that runs every retention policy against a real PostgreSQL server, and is skipped unless
/// <c>PLANORA_TEST_POSTGRES</c> names one.
/// </summary>
/// <remarks>
/// The policy suites next to this folder run in dry-run on EF InMemory, which stops before the delete:
/// <c>ExecuteDelete</c>, <c>ExecuteUpdate</c> and the advisory lock are PostgreSQL-only, and none of them
/// had ever executed — the subsystem shipped disabled everywhere. These tests run each policy live
/// (dry-run off, real advisory lock) on each service's own <c>DbContext</c> model, so the SQL that actually
/// deletes data is exercised. The variable holds a server connection string without a database, e.g.
/// <c>Host=127.0.0.1;Port=5432;Username=postgres;Password=postgres</c>; every test creates its own
/// throwaway database and drops it afterwards.
/// </remarks>
public sealed class PostgresFactAttribute : FactAttribute
{
    public const string Variable = "PLANORA_TEST_POSTGRES";

    public PostgresFactAttribute()
    {
        if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable(Variable)))
        {
            Skip = $"Set {Variable} to a PostgreSQL server connection string to run the retention policies against a real database.";
        }
    }
}

/// <summary>A uniquely named database on the <c>PLANORA_TEST_POSTGRES</c> server, dropped on dispose.</summary>
internal sealed class TemporaryDatabase : IAsyncDisposable
{
    private readonly string _server;

    private TemporaryDatabase(string server, string name)
    {
        _server = server;
        Name = name;
        ConnectionString = new NpgsqlConnectionStringBuilder(server) { Database = name, Pooling = false }.ConnectionString;
    }

    public string Name { get; }

    public string ConnectionString { get; }

    public static async Task<TemporaryDatabase> CreateAsync()
    {
        var server = Environment.GetEnvironmentVariable(PostgresFactAttribute.Variable)!;
        var name = $"planora_retention_{Guid.NewGuid():N}";
        await ExecuteOnServerAsync(server, $"CREATE DATABASE \"{name}\"");
        return new TemporaryDatabase(server, name);
    }

    /// <summary>
    /// Options as the services register them: Npgsql with the retrying execution strategy, which is the
    /// configuration the policies run under in production.
    /// </summary>
    public DbContextOptions<TContext> Options<TContext>() where TContext : DbContext =>
        new DbContextOptionsBuilder<TContext>()
            .UseNpgsql(ConnectionString, npgsql => npgsql.EnableRetryOnFailure(3, TimeSpan.FromSeconds(1), null))
            .Options;

    public async ValueTask DisposeAsync() =>
        await ExecuteOnServerAsync(_server, $"DROP DATABASE IF EXISTS \"{Name}\" WITH (FORCE)");

    private static async Task ExecuteOnServerAsync(string server, string sql)
    {
        var builder = new NpgsqlConnectionStringBuilder(server) { Database = "postgres", Pooling = false };
        await using var connection = new NpgsqlConnection(builder.ConnectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(sql, connection);
        await command.ExecuteNonQueryAsync();
    }
}

internal static class RetentionTestKit
{
    /// <summary>
    /// The live configuration a production pass runs with, at a batch size of two so every policy
    /// deletes across several batches and its loop and batch-boundary ordering are exercised.
    /// </summary>
    public static RetentionOptions Live(Action<RetentionOptions>? configure = null)
    {
        var options = new RetentionOptions { Enabled = true, DryRun = false, BatchSize = 2, MaxDeletionsPerRun = 1000 };
        configure?.Invoke(options);
        return options;
    }

    public static Task<RetentionResult> RunAsync(
        IRetentionPolicy policy, IServiceProvider scopedServices, RetentionOptions options, DateTime utcNow) =>
        policy.ExecuteAsync(scopedServices, new RetentionContext(options, utcNow), CancellationToken.None);

    /// <summary>
    /// Writes a property whose setter is private or protected — the timestamps the domain stamps with
    /// "now" (CompletedAt, DeletedAt, ReadAtUtc…) have to be moved into the past to be eligible.
    /// </summary>
    public static void Set(object entity, string property, object? value)
    {
        for (var type = entity.GetType(); type is not null; type = type.BaseType)
        {
            var info = type.GetProperty(property, BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.DeclaredOnly);
            var setter = info?.GetSetMethod(nonPublic: true);
            if (setter is null) continue;
            setter.Invoke(entity, new[] { value });
            return;
        }

        throw new InvalidOperationException($"{entity.GetType().Name} has no settable {property}.");
    }
}
