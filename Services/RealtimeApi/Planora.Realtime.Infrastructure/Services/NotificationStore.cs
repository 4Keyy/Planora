using System.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Npgsql;
using Planora.Realtime.Application.Interfaces;
using Planora.Realtime.Domain.Entities;
using Planora.Realtime.Infrastructure.Persistence;
using Planora.Realtime.Infrastructure.Persistence.Configurations;

namespace Planora.Realtime.Infrastructure.Services;

/// <summary>
/// Postgres-backed notification log with source-event deduplication and deletion guards.
/// </summary>
public sealed class NotificationStore : INotificationStore
{
    private readonly RealtimeDbContext _db;
    private readonly ILogger<NotificationStore> _logger;

    public NotificationStore(RealtimeDbContext db, ILogger<NotificationStore> logger)
    {
        _db = db;
        _logger = logger;
    }

    public async Task<bool> TryAddAsync(Notification notification, CancellationToken cancellationToken = default)
    {
        try
        {
            return await _db.Database.CreateExecutionStrategy().ExecuteInTransactionAsync(
                notification,
                async (note, token) =>
                {
                    // Always lock recipient before task. Cleanup takes only the affected scope.
                    await LockScopeAsync(NotificationDeletionScope.Recipient, note.UserId, token);
                    if (note.TaskId != Guid.Empty)
                        await LockScopeAsync(NotificationDeletionScope.Task, note.TaskId, token);

                    // Query after acquiring the locks to see any cleanup that committed while waiting.
                    if (await _db.NotificationDeletions.AnyAsync(d =>
                            (d.Scope == NotificationDeletionScope.Recipient && d.ScopeId == note.UserId) ||
                            (d.Scope == NotificationDeletionScope.Task && d.ScopeId == note.TaskId), token) ||
                        await _db.Notifications.IgnoreQueryFilters().AnyAsync(n => n.SourceEventId == note.SourceEventId, token))
                        return false;

                    _db.Notifications.Add(note);
                    try
                    {
                        await _db.SaveChangesAsync(token);
                        return true;
                    }
                    finally
                    {
                        // Each retry must start without a tracked row from a rolled-back attempt.
                        _db.Entry(note).State = EntityState.Detached;
                    }
                },
                (note, token) => _db.Notifications.IgnoreQueryFilters().AnyAsync(n => n.Id == note.Id, token),
                IsolationLevel.ReadCommitted,
                cancellationToken);
        }
        catch (DbUpdateException ex) when (ex.InnerException is PostgresException
        {
            SqlState: PostgresErrorCodes.UniqueViolation,
            ConstraintName: NotificationConfiguration.SourceEventIndex
        })
        {
            _logger.LogDebug(
                "Notification for source event {SourceEventId} already stored by a concurrent consumer",
                notification.SourceEventId);
            return false;
        }
    }

    public Task<int> DeleteByTaskIdAsync(Guid taskId, CancellationToken cancellationToken = default) =>
        DeleteAsync(NotificationDeletionScope.Task, taskId, cancellationToken);

    public Task<int> DeleteByUserIdAsync(Guid userId, CancellationToken cancellationToken = default) =>
        DeleteAsync(NotificationDeletionScope.Recipient, userId, cancellationToken);

    private async Task<int> DeleteAsync(NotificationDeletionScope scope, Guid id, CancellationToken cancellationToken)
    {
        if (id == Guid.Empty)
            return 0; // Guid.Empty is the absence sentinel for task scope.

        return await _db.Database.CreateExecutionStrategy().ExecuteAsync(async token =>
        {
            await using var transaction = await _db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, token);
            await LockScopeAsync(scope, id, token);
            await _db.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO "NotificationDeletions" ("Scope", "ScopeId")
                VALUES ({(int)scope}, {id}) ON CONFLICT ("Scope", "ScopeId") DO NOTHING
                """, token);

            var byTask = scope == NotificationDeletionScope.Task;
            var notifications = _db.Notifications.IgnoreQueryFilters();
            var affected = byTask
                ? notifications.Where(n => n.TaskId == id)
                : notifications.Where(n => n.UserId == id);
            // The delivery table has no FK. Keep dependent cleanup in the same transaction.
            var affectedIds = affected.Select(n => n.Id);
            var deliveries = byTask
                ? _db.NotificationDeliveries.Where(d => affectedIds.Contains(d.NotificationId))
                : _db.NotificationDeliveries.Where(d => d.UserId == id);
            await deliveries.ExecuteDeleteAsync(token);
            var removed = await affected.ExecuteDeleteAsync(token);
            await transaction.CommitAsync(token);
            return removed;
        }, cancellationToken);
    }

    private Task LockScopeAsync(NotificationDeletionScope scope, Guid id, CancellationToken cancellationToken)
    {
        // Distinct first keys keep task and recipient locks in disjoint namespaces.
        // A hash collision within one scope only serializes two unrelated operations.
        var lockNamespace = 742810640 + (int)scope;
        return _db.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT pg_catalog.pg_advisory_xact_lock({lockNamespace}, pg_catalog.hashtext({id.ToString("N")}))",
            cancellationToken);
    }
}

/// <summary>
/// No-op store used when the Realtime service runs without a configured database (test hosts,
/// ephemeral local runs — see <c>AddRealtimeInfrastructure</c>). It performs no dedupe or
/// persistence and always reports "newly stored" so the consumer still pushes the notification over
/// SignalR (ephemeral best-effort delivery), preserving the pre-persistence behavior.
/// </summary>
public sealed class NullNotificationStore : INotificationStore
{
    public Task<bool> TryAddAsync(Notification notification, CancellationToken cancellationToken = default)
        => Task.FromResult(true);

    public Task<int> DeleteByTaskIdAsync(Guid taskId, CancellationToken cancellationToken = default)
        => Task.FromResult(0);

    public Task<int> DeleteByUserIdAsync(Guid userId, CancellationToken cancellationToken = default)
        => Task.FromResult(0);
}
