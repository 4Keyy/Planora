using Microsoft.EntityFrameworkCore;
using Planora.Realtime.Application.Interfaces;
using Planora.Realtime.Domain.Entities;
using Planora.Realtime.Infrastructure.Persistence;

namespace Planora.Realtime.Infrastructure.Services;

/// <summary>
/// Postgres-backed durable notification log. Idempotent on <see cref="Notification.SourceEventId"/>:
/// a redelivered integration event (transient RabbitMQ redelivery, replay) lands a row at most once,
/// enforced both by a pre-check and the unique index (race-safe).
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
        // Fast path: skip the insert when this source event already produced a row. IgnoreQueryFilters
        // so a soft-deleted twin still counts as a duplicate (the unique index ignores the filter too).
        var exists = await _db.Notifications
            .IgnoreQueryFilters()
            .AsNoTracking()
            .AnyAsync(x => x.SourceEventId == notification.SourceEventId, cancellationToken);
        if (exists)
            return false;

        _db.Notifications.Add(notification);
        try
        {
            await _db.SaveChangesAsync(cancellationToken);
            return true;
        }
        catch (DbUpdateException ex)
        {
            // A concurrent consumer won the race on the unique SourceEventId index. Treat as a
            // duplicate (idempotent) rather than a failure, so the message is acked, not retried.
            _db.Entry(notification).State = EntityState.Detached;
            var duplicate = await _db.Notifications
                .IgnoreQueryFilters()
                .AsNoTracking()
                .AnyAsync(x => x.SourceEventId == notification.SourceEventId, cancellationToken);
            if (duplicate)
            {
                _logger.LogDebug(
                    "Notification for source event {SourceEventId} already stored by a concurrent consumer",
                    notification.SourceEventId);
                return false;
            }

            _logger.LogError(ex, "Failed to persist notification for source event {SourceEventId}", notification.SourceEventId);
            throw;
        }
    }

    public async Task<int> DeleteByTaskIdAsync(Guid taskId, CancellationToken cancellationToken = default)
    {
        if (taskId == Guid.Empty)
            return 0; // Guid.Empty means "not task-scoped" — never mass-delete non-scoped notifications.

        // Delivery rows have no FK/cascade to the notification, so remove them first by joining on the
        // set of notification ids for this task, then remove the notifications themselves.
        var noteIds = _db.Notifications.IgnoreQueryFilters().Where(n => n.TaskId == taskId).Select(n => n.Id);
        await _db.NotificationDeliveries
            .Where(d => noteIds.Contains(d.NotificationId))
            .ExecuteDeleteAsync(cancellationToken);

        return await _db.Notifications.IgnoreQueryFilters()
            .Where(n => n.TaskId == taskId)
            .ExecuteDeleteAsync(cancellationToken);
    }

    public async Task<int> DeleteByUserIdAsync(Guid userId, CancellationToken cancellationToken = default)
    {
        if (userId == Guid.Empty)
            return 0;

        await _db.NotificationDeliveries
            .Where(d => d.UserId == userId)
            .ExecuteDeleteAsync(cancellationToken);

        return await _db.Notifications.IgnoreQueryFilters()
            .Where(n => n.UserId == userId)
            .ExecuteDeleteAsync(cancellationToken);
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
