using System.Data;
using System.Data.Common;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Npgsql;

namespace Planora.BuildingBlocks.Infrastructure.Persistence;

/// <summary>Renders catalog expressions under a trusted path without owning the caller's transaction.</summary>
internal sealed class PostgreSqlCatalogScope : IAsyncDisposable
{
    private static readonly TimeSpan CleanupTimeout = TimeSpan.FromSeconds(5);
    private readonly DbContext _db;
    private readonly DbConnection _connection;
    private IDbContextTransaction? _ownedTransaction;
    private DbTransaction? _transaction;
    private string? _previousPath;
    private bool _openedConnection;
    private bool _restorePath;
    private bool _transactionRequested;
    private int _disposeStarted;

    private PostgreSqlCatalogScope(DbContext db)
    {
        _db = db;
        _connection = db.Database.GetDbConnection();
    }

    internal static async Task<PostgreSqlCatalogScope> OpenAsync(DbContext db, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(db);
        cancellationToken.ThrowIfCancellationRequested();
        if (!db.Database.IsNpgsql())
            throw new InvalidOperationException("Catalog rendering requires PostgreSQL.");

        var scope = new PostgreSqlCatalogScope(db);
        try
        {
            if (scope._connection.State != ConnectionState.Open)
            {
                // Track the open attempt too: cancellation can arrive after the server opened it.
                scope._openedConnection = true;
                await db.Database.OpenConnectionAsync(cancellationToken);
            }

            if (db.Database.CurrentTransaction is null)
            {
                scope._transactionRequested = true;
                scope._ownedTransaction = await db.Database.BeginTransactionAsync(cancellationToken);
                scope._transaction = scope._ownedTransaction.GetDbTransaction();
                await using var readOnly = scope.Command("SET TRANSACTION READ ONLY");
                await readOnly.ExecuteNonQueryAsync(cancellationToken);
            }
            else
            {
                scope._transaction = db.Database.CurrentTransaction.GetDbTransaction();
            }

            await using (var read = scope.Command("SELECT pg_catalog.current_setting('search_path')"))
            {
                scope._previousPath = (string?)await read.ExecuteScalarAsync(cancellationToken)
                    ?? throw new InvalidOperationException("The catalog rendering path could not be read.");
            }

            // Restore after an uncertain SET outcome as well as after an acknowledged one.
            scope._restorePath = true;
            await scope.SetPathAsync("pg_catalog, pg_temp", cancellationToken);
            return scope;
        }
        catch (Exception operationFailure)
        {
            await scope.DisposeAsync(operationFailure);
            throw;
        }
    }

    public ValueTask DisposeAsync() => DisposeAsync(operationFailure: null);

    /// <summary>Allows a caller to retain both its operation failure and a fatal cleanup failure.</summary>
    internal async ValueTask DisposeAsync(Exception? operationFailure)
    {
        if (Interlocked.Exchange(ref _disposeStarted, 1) != 0)
            return;

        var failures = new List<Exception>();
        if (_restorePath && _previousPath is not null)
        {
            try
            {
                using var cleanup = new CancellationTokenSource(CleanupTimeout);
                await SetPathAsync(_previousPath, cleanup.Token);
            }
            catch (Exception error)
            {
                failures.Add(error);
            }
        }

        if (_ownedTransaction is not null)
        {
            try
            {
                using var cleanup = new CancellationTokenSource(CleanupTimeout);
                await _ownedTransaction.RollbackAsync(cleanup.Token);
            }
            catch (Exception error)
            {
                failures.Add(error);
            }
            try
            {
                await _ownedTransaction.DisposeAsync().AsTask().WaitAsync(CleanupTimeout);
            }
            catch (Exception error)
            {
                failures.Add(error);
            }
        }

        // A failed BEGIN can leave an uncertain transaction outcome even without an EF handle.
        var uncertainBegin = _transactionRequested && _ownedTransaction is null;
        if (_openedConnection || failures.Count > 0 || uncertainBegin)
        {
            if (failures.Count > 0 || uncertainBegin)
            {
                try
                {
                    // Do not return a connection with an uncertain trust scope to its pool.
                    if (_connection is NpgsqlConnection npgsql)
                        NpgsqlConnection.ClearPool(npgsql);
                }
                catch (Exception error)
                {
                    failures.Add(error);
                }
            }
            try
            {
                if (_openedConnection)
                    await _db.Database.CloseConnectionAsync().WaitAsync(CleanupTimeout);
                else
                    await _connection.CloseAsync().WaitAsync(CleanupTimeout);
            }
            catch (Exception error)
            {
                failures.Add(error);
            }
        }

        if (failures.Count > 0)
        {
            if (operationFailure is not null)
                failures.Insert(0, operationFailure);
            // This must never be interpreted as a different compatible adoption candidate.
            throw new InvalidOperationException(
                "Catalog rendering cleanup failed; the connection cannot be reused safely.",
                new AggregateException(failures));
        }
    }

    private async Task SetPathAsync(string path, CancellationToken cancellationToken)
    {
        await using var command = Command("SELECT pg_catalog.set_config('search_path', @path, true)");
        var parameter = command.CreateParameter();
        parameter.ParameterName = "path";
        parameter.Value = path;
        command.Parameters.Add(parameter);
        await command.ExecuteScalarAsync(cancellationToken);
    }

    private DbCommand Command(string sql)
    {
        var command = _connection.CreateCommand();
        command.CommandText = sql;
        command.CommandTimeout = 5;
        command.Transaction = _transaction;
        return command;
    }
}
