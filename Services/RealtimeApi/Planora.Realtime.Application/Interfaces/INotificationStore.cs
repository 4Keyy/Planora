using Planora.Realtime.Domain.Entities;

namespace Planora.Realtime.Application.Interfaces;

/// <summary>
/// Write side of the notification log. The durable implementation persists before fan-out and
/// deduplicates on <see cref="Notification.SourceEventId"/> while the row exists.
/// </summary>
public interface INotificationStore
{
    /// <summary>
    /// Persists <paramref name="notification"/> unless the source event already has a row
    /// or the task or recipient was deleted.
    /// </summary>
    /// <returns>
    /// <c>true</c> when accepted for delivery. <c>false</c> means the caller must skip delivery.
    /// </returns>
    Task<bool> TryAddAsync(Notification notification, CancellationToken cancellationToken = default);

    /// <summary>
    /// Marks the task deleted and hard-deletes its notifications and delivery rows atomically.
    /// Idempotent. Returns the number of notification rows removed by the completed attempt.
    /// </summary>
    Task<int> DeleteByTaskIdAsync(Guid taskId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Marks the recipient deleted and hard-deletes their notifications and delivery rows atomically.
    /// Idempotent. Returns the number of notification rows removed by the completed attempt.
    /// </summary>
    Task<int> DeleteByUserIdAsync(Guid userId, CancellationToken cancellationToken = default);
}
