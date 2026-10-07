using System.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Metadata;
using Microsoft.EntityFrameworkCore.Storage;
using Microsoft.Extensions.Logging;
using Npgsql;
using Planora.BuildingBlocks.Infrastructure.Persistence;
using Planora.BuildingBlocks.Infrastructure.Resilience;

namespace Planora.Realtime.Infrastructure.Persistence;

/// <summary>Prepares the optional durable log before the host accepts events.</summary>
public static class RealtimeDatabaseStartup
{
    private const int MaxAttempts = 5;

    public static async Task EnsureReadyAsync(
        RealtimeDbContext? db,
        ILogger logger,
        CancellationToken cancellationToken)
    {
        if (db is null || !db.Database.IsRelational())
        {
            return;
        }

        cancellationToken.ThrowIfCancellationRequested();
        var connectionString = db.Database.GetConnectionString()
            ?? throw new InvalidOperationException("Realtime database connection string is missing.");
        var databaseName = new NpgsqlConnectionStringBuilder(connectionString).Database;
        if (string.IsNullOrWhiteSpace(databaseName))
        {
            throw new InvalidOperationException("Realtime database name must be configured.");
        }

        for (var attempt = 1; ; attempt++)
        {
            try
            {
                await DependencyWaiter.WaitForPostgresWithDatabaseCreationAsync(
                    connectionString, databaseName, logger, cancellationToken);
                await PrepareSchemaAsync(db, logger, cancellationToken);
                return;
            }
            catch (NpgsqlException ex) when (ex.IsTransient && attempt < MaxAttempts)
            {
                logger.LogWarning(ex,
                    "Realtime database startup failed transiently; retry {Attempt}/{MaxAttempts}",
                    attempt, MaxAttempts);
                await Task.Delay(TimeSpan.FromSeconds(2), cancellationToken);
            }
        }
    }

    private static async Task PrepareSchemaAsync(
        RealtimeDbContext db,
        ILogger logger,
        CancellationToken cancellationToken)
    {
        var applied = (await db.Database.GetAppliedMigrationsAsync(cancellationToken)).ToArray();
        var unmanaged = applied.Length == 0
            && await db.GetService<IRelationalDatabaseCreator>().HasTablesAsync(cancellationToken);

        if (applied.Length > 0)
        {
            var known = db.Database.GetMigrations().ToHashSet(StringComparer.Ordinal);
            var unknown = applied.Where(migration => !known.Contains(migration)).ToArray();
            if (unknown.Length > 0)
            {
                throw IncompatibleSchema(
                    "migration history contains IDs absent from this build: " + string.Join(", ", unknown));
            }
        }

        if (!unmanaged)
        {
            await DatabaseStartup.EnsureReadyAsync(db, logger, cancellationToken);
        }

        await VerifySchemaAsync(db, cancellationToken);

        if (unmanaged)
        {
            logger.LogWarning(
                "Realtime database has a compatible schema without EF migration history. " +
                "Existing data and history were left unchanged; future schema changes require an explicit migration plan.");
        }
    }

    private static async Task VerifySchemaAsync(RealtimeDbContext db, CancellationToken cancellationToken)
    {
        // Use full model metadata; runtime models may omit store/index annotations.
        // Only mapped columns are checked, so PostgreSQL system columns (including xmin) are harmless.
        var tables = db.GetService<IDesignTimeModel>().Model.GetRelationalModel().Tables;
        var connection = db.Database.GetDbConnection();
        var openedHere = connection.State != ConnectionState.Open;
        if (openedHere)
        {
            await connection.OpenAsync(cancellationToken);
        }

        try
        {
            foreach (var table in tables)
            {
                var schema = table.Schema ?? "public";
                var actualColumns = new Dictionary<string, (string Type, bool Nullable, bool DatabaseSupplied)>(StringComparer.Ordinal);
                await using (var query = connection.CreateCommand())
                {
                    query.CommandText = """
                        SELECT a.attname, pg_catalog.format_type(a.atttypid, a.atttypmod), NOT a.attnotnull,
                               a.atthasdef OR a.attgenerated <> '' OR a.attidentity <> ''
                        FROM pg_catalog.pg_attribute a
                        JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
                        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                        WHERE n.nspname = @schema AND c.relname = @table AND c.relkind IN ('r', 'p')
                          AND a.attnum > 0 AND NOT a.attisdropped
                        """;
                    AddParameter(query, "schema", schema);
                    AddParameter(query, "table", table.Name);
                    await using var reader = await query.ExecuteReaderAsync(cancellationToken);
                    while (await reader.ReadAsync(cancellationToken))
                    {
                        actualColumns.Add(reader.GetString(0),
                            (reader.GetString(1), reader.GetBoolean(2), reader.GetBoolean(3)));
                    }
                }

                if (actualColumns.Count == 0)
                {
                    throw IncompatibleSchema($"required table {schema}.{table.Name} is missing");
                }

                foreach (var column in table.Columns)
                {
                    var name = $"{table.Name}.{column.Name}";
                    if (!actualColumns.TryGetValue(column.Name, out var actual))
                    {
                        throw IncompatibleSchema($"required column {name} is missing");
                    }
                    if (!string.Equals(actual.Type, column.StoreType, StringComparison.OrdinalIgnoreCase))
                    {
                        throw IncompatibleSchema($"column {name} has type {actual.Type}; expected {column.StoreType}");
                    }
                    if (actual.Nullable != column.IsNullable)
                    {
                        throw IncompatibleSchema($"column {name} has incompatible nullability");
                    }
                }

                // Extra nullable or database-generated columns are compatible, but an unmapped
                // required value would make the first notification insert fail after startup.
                var mappedColumns = table.Columns.Select(column => column.Name).ToHashSet(StringComparer.Ordinal);
                foreach (var column in actualColumns.Where(column => !mappedColumns.Contains(column.Key)))
                {
                    if (!column.Value.Nullable && !column.Value.DatabaseSupplied)
                    {
                        throw IncompatibleSchema(
                            $"unmapped required column {table.Name}.{column.Key} has no default, generated value or identity");
                    }
                }

                var actualKeys = new List<(bool Primary, string[] Columns)>();
                await using (var query = connection.CreateCommand())
                {
                    query.CommandText = """
                        SELECT i.indisprimary, array_agg(a.attname::text ORDER BY k.ordinality)
                        FROM pg_catalog.pg_index i
                        JOIN pg_catalog.pg_class c ON c.oid = i.indrelid
                        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                        JOIN LATERAL unnest(i.indkey) WITH ORDINALITY k(attnum, ordinality) ON TRUE
                        JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum
                        WHERE n.nspname = @schema AND c.relname = @table
                          AND i.indisunique AND i.indisvalid AND i.indpred IS NULL AND i.indexprs IS NULL
                          AND k.ordinality <= i.indnkeyatts
                        GROUP BY i.indexrelid, i.indisprimary
                        """;
                    AddParameter(query, "schema", schema);
                    AddParameter(query, "table", table.Name);
                    await using var reader = await query.ExecuteReaderAsync(cancellationToken);
                    while (await reader.ReadAsync(cancellationToken))
                    {
                        actualKeys.Add((reader.GetBoolean(0), reader.GetFieldValue<string[]>(1)));
                    }
                }

                if (table.PrimaryKey is not null)
                {
                    var columns = table.PrimaryKey.Columns.Select(column => column.Name).ToArray();
                    if (!actualKeys.Any(key => key.Primary && key.Columns.SequenceEqual(columns)))
                    {
                        throw IncompatibleSchema($"table {table.Name} lacks the primary key ({string.Join(", ", columns)})");
                    }
                }

                foreach (var index in table.Indexes.Where(index => index.IsUnique))
                {
                    var columns = index.Columns.Select(column => column.Name).ToArray();
                    if (!actualKeys.Any(key => key.Columns.SequenceEqual(columns)))
                    {
                        throw IncompatibleSchema($"table {table.Name} lacks the unique key ({string.Join(", ", columns)})");
                    }
                }
            }
        }
        finally
        {
            if (openedHere)
            {
                await connection.CloseAsync();
            }
        }
    }

    private static void AddParameter(System.Data.Common.DbCommand query, string name, string value)
    {
        var parameter = query.CreateParameter();
        parameter.ParameterName = name;
        parameter.Value = value;
        query.Parameters.Add(parameter);
    }

    private static InvalidOperationException IncompatibleSchema(string detail) =>
        new("Realtime database is incompatible: " + detail + ". " +
            "Startup stopped without adopting or repairing an existing schema. " +
            "Restore a compatible backup or apply an explicit migration plan using the matching build.");
}
