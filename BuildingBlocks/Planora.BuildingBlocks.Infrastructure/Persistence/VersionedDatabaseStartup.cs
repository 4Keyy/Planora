using System.Data;
using System.Transactions;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Metadata;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Storage;
using Npgsql;

namespace Planora.BuildingBlocks.Infrastructure.Persistence;

/// <summary>Prepares a reviewed migration chain without adopting unknown database shapes.</summary>
public static class VersionedDatabaseStartup
{
    private static readonly TimeSpan CleanupTimeout = TimeSpan.FromSeconds(5);

    public static async Task EnsureReadyAsync(DbContext db, string reviewedBaselineId, ILogger logger,
        CancellationToken cancellationToken = default, string? lastReviewedAdoptionMigrationId = null)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var known = CodeChain(db, reviewedBaselineId);
        var adoptionCeiling = Array.IndexOf(known, lastReviewedAdoptionMigrationId ?? reviewedBaselineId);
        if (adoptionCeiling < 0) throw Incompatible("the reviewed adoption limit is absent from this build");
        if (db.Database.HasPendingModelChanges()) throw Incompatible("the model differs from the compiled migration snapshot");
        RejectApplicationTransaction(db);

        await db.Database.CreateExecutionStrategy().ExecuteAsync(_ => WithPreparationSessionAsync(db, async () =>
        {
            var adoptedCount = 0;
            await using (var transaction = await db.Database.BeginTransactionAsync(cancellationToken))
            {
                await db.Database.ExecuteSqlRawAsync("SELECT pg_catalog.pg_advisory_xact_lock(742810634::bigint)", cancellationToken);
                var applied = await ReadAppliedHistory(db, cancellationToken);
                VerifyHistory(known, applied);
                if (applied.Length == 0 && await HasUserObjects(db, cancellationToken))
                {
                    var adoptedIndex = -1;
                    for (var candidate = adoptionCeiling; candidate >= 0; candidate--)
                    {
                        try
                        {
                            await PostgreSqlSchemaCompatibility.VerifyAsync(db, TargetModel(db, known[candidate]), cancellationToken);
                            adoptedIndex = candidate;
                            break;
                        }
                        catch (DatabaseSchemaCompatibilityException) when (candidate > 0)
                        {
                            // Only explicitly reviewed prefix targets may be tried; no ID is inferred from the database.
                        }
                    }
                    if (adoptedIndex < 0) throw Incompatible("no reviewed unmanaged baseline matches this database");
                    var history = db.GetService<IHistoryRepository>();
                    await db.Database.ExecuteSqlRawAsync(history.GetCreateIfNotExistsScript(), cancellationToken);
                    foreach (var id in known.Take(adoptedIndex + 1))
                        await db.Database.ExecuteSqlRawAsync(history.GetInsertScript(new HistoryRow(id, ProductInfo.GetVersion())), cancellationToken);
                    adoptedCount = adoptedIndex + 1;
                }
                else if (applied.Length > 0)
                {
                    await PostgreSqlSchemaCompatibility.VerifyAsync(db, TargetModel(db, applied[^1]), cancellationToken);
                }
                await transaction.CommitAsync(cancellationToken);
            }
            if (adoptedCount > 0)
                logger.LogWarning("Adopted {Count} reviewed migration IDs for {DbContext} after schema equivalence; existing rows preserved",
                    adoptedCount, db.GetType().Name);

            await db.Database.MigrateAsync(cancellationToken);
            var finalHistory = await ReadAppliedHistory(db, cancellationToken);
            VerifyHistory(known, finalHistory);
            if (!finalHistory.SequenceEqual(known)) throw Incompatible("not all reviewed migrations were applied");
            await PostgreSqlSchemaCompatibility.VerifyAsync(db, db.GetService<IDesignTimeModel>().Model, cancellationToken);
        }, cancellationToken), cancellationToken);
        logger.LogInformation("Database {DbContext} is ready with {Count} reviewed migrations", db.GetType().Name, known.Length);
    }

    /// <summary>Validates history provenance only; it neither mutates nor certifies the physical schema.</summary>
    public static async Task<string[]> ValidateHistoryAsync(DbContext db, string reviewedBaselineId, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var known = CodeChain(db, reviewedBaselineId);
        RejectApplicationTransaction(db);
        string[] applied = [];
        await db.Database.CreateExecutionStrategy().ExecuteAsync(_ => WithPreparationSessionAsync(db, async () =>
        {
            applied = await ReadAppliedHistory(db, cancellationToken);
            VerifyHistory(known, applied);
        }, cancellationToken), cancellationToken);
        return applied;
    }

    private static string[] CodeChain(DbContext db, string baseline)
    {
        if (!db.Database.IsNpgsql()) throw Incompatible("the reviewed chain requires PostgreSQL");
        var known = db.Database.GetMigrations().ToArray();
        if (known.Length == 0 || known[0] != baseline) throw Incompatible("the reviewed baseline is absent from this build");
        return known;
    }

    private static void VerifyHistory(string[] known, string[] applied)
    {
        if (!applied.SequenceEqual(known.Take(applied.Length)))
            throw Incompatible("migration history is unknown or is not a chronological prefix of the reviewed chain");
    }

    private static IModel TargetModel(DbContext db, string migrationId)
    {
        var assembly = db.GetService<IMigrationsAssembly>();
        var model = assembly.CreateMigration(assembly.Migrations[migrationId], db.Database.ProviderName!).TargetModel;
        return db.GetService<IModelRuntimeInitializer>().Initialize(model, designTime: true);
    }

    private static async Task<string[]> ReadAppliedHistory(DbContext db, CancellationToken cancellationToken)
    {
        // A missing table must not abort our transaction, and an unreviewed relation
        // must never be read as EF history before its catalog/security preflight.
        var exists = await PostgreSqlSchemaCompatibility.VerifyPreparationObjectsAsync(db, cancellationToken);
        return exists ? (await db.Database.GetAppliedMigrationsAsync(cancellationToken)).ToArray() : [];
    }

    private static void RejectApplicationTransaction(DbContext db)
    {
        if (db.Database.CurrentTransaction is not null || Transaction.Current is not null)
            throw Incompatible("preparation cannot run inside an application transaction");
    }

    private static async Task WithPreparationSessionAsync(DbContext db, Func<Task> operation, CancellationToken cancellationToken)
    {
        var connection = db.Database.GetDbConnection();
        var openedConnection = connection.State != ConnectionState.Open;
        string? previousPath = null;
        var pathRequested = false;
        var lockRequested = false;
        Exception? operationFailure = null;
        try
        {
            if (openedConnection) await db.Database.OpenConnectionAsync(cancellationToken);
            previousPath = (string?)await ScalarAsync(db, "SELECT pg_catalog.current_setting('search_path')", cancellationToken)
                ?? throw Incompatible("the preparation search path could not be read");
            pathRequested = true;
            await SetSessionPathAsync(db, "public, pg_temp", cancellationToken);

            // Reentrant session locks are counted. Do not consume a caller's existing
            // hold when a canceled acquisition has an uncertain server outcome.
            var held = (bool)(await ScalarAsync(db, """
                SELECT EXISTS(SELECT 1 FROM pg_catalog.pg_locks
                    WHERE locktype='advisory' AND pid=pg_catalog.pg_backend_pid() AND granted
                      AND classid=0::oid AND objid=742810634::oid AND objsubid=1)
                """, cancellationToken))!;
            if (held) throw Incompatible("this connection already holds the preparation advisory lock");

            lockRequested = true;
            await ScalarAsync(db, "SELECT pg_catalog.pg_advisory_lock(742810634::bigint)", cancellationToken);
            await operation();
        }
        catch (Exception error)
        {
            operationFailure = error;
            throw;
        }
        finally
        {
            var failures = new List<Exception>();
            var lostConnection = connection.State != ConnectionState.Open && (pathRequested || lockRequested);
            if (connection.State == ConnectionState.Open)
            {
                if (lockRequested)
                {
                    try
                    {
                        using var cleanup = new CancellationTokenSource(CleanupTimeout);
                        var released = (bool)(await ScalarAsync(db,
                            "SELECT pg_catalog.pg_advisory_unlock(742810634::bigint)", cleanup.Token, timeout: 5))!;
                        if (!released && operationFailure is null)
                            throw Incompatible("the preparation session lost its advisory lock");
                    }
                    catch (Exception error) { failures.Add(error); }
                }
                if (pathRequested && previousPath is not null)
                {
                    try
                    {
                        using var cleanup = new CancellationTokenSource(CleanupTimeout);
                        await SetSessionPathAsync(db, previousPath, cleanup.Token, timeout: 5);
                    }
                    catch (Exception error) { failures.Add(error); }
                }
            }
            else if (lostConnection && operationFailure is null)
            {
                failures.Add(Incompatible("the preparation connection closed before its session state could be verified"));
            }

            if (failures.Count > 0 || lostConnection)
            {
                try
                {
                    if (connection is NpgsqlConnection npgsql) NpgsqlConnection.ClearPool(npgsql);
                }
                catch (Exception error) { failures.Add(error); }
            }
            if (openedConnection || failures.Count > 0 || lostConnection)
            {
                try
                {
                    if (openedConnection)
                        await db.Database.CloseConnectionAsync().WaitAsync(CleanupTimeout);
                    else
                        await connection.CloseAsync().WaitAsync(CleanupTimeout);
                }
                catch (Exception error) { failures.Add(error); }
            }
            if (failures.Count > 0)
            {
                if (operationFailure is not null) failures.Insert(0, operationFailure);
                throw new InvalidOperationException("Preparation session cleanup failed; the connection cannot be reused safely.",
                    new AggregateException(failures));
            }
        }
    }

    private static Task<object?> ScalarAsync(DbContext db, string sql, CancellationToken cancellationToken, int? timeout = null) =>
        ExecuteScalarAsync(db, sql, parameter: null, cancellationToken, timeout);

    private static Task<object?> SetSessionPathAsync(DbContext db, string path, CancellationToken cancellationToken, int? timeout = null) =>
        ExecuteScalarAsync(db, "SELECT pg_catalog.set_config('search_path', @path, false)", path, cancellationToken, timeout);

    private static async Task<object?> ExecuteScalarAsync(DbContext db, string sql, string? parameter,
        CancellationToken cancellationToken, int? timeout)
    {
        await using var command = db.Database.GetDbConnection().CreateCommand();
        command.CommandText = sql;
        command.CommandTimeout = timeout ?? db.Database.GetCommandTimeout() ?? 30;
        command.Transaction = db.Database.CurrentTransaction?.GetDbTransaction();
        if (parameter is not null)
        {
            var value = command.CreateParameter(); value.ParameterName = "path"; value.Value = parameter;
            command.Parameters.Add(value);
        }
        return await command.ExecuteScalarAsync(cancellationToken);
    }

    private static Task<bool> HasUserObjects(DbContext db, CancellationToken cancellationToken) =>
        db.Database.SqlQueryRaw<bool>("""
            SELECT EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
                WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%'
                  AND n.oid<>pg_catalog.pg_my_temp_schema() AND NOT pg_catalog.pg_is_other_temp_schema(n.oid)
                  AND c.relkind IN ('r','p','v','m','f')
                  AND NOT (n.nspname='public' AND c.relname='__EFMigrationsHistory')) AS "Value"
            """).SingleAsync(cancellationToken);

    private static InvalidOperationException Incompatible(string detail) =>
        new("Versioned database preparation stopped: " + detail + ". Preserve data/history and use a reviewed migration plan.");
}
