using Planora.Realtime.Domain.Entities;

namespace Planora.Realtime.Application.Interfaces;

/// <summary>
/// Write side of the durable notification log. Persisting before fan-out lets a restarted pod
/// re-deliver to clients that reconnect, and backs the read-model the UI queries. Implementations
/// are idempotent on <see cref="Notification.SourceEventId"/> so a redelivered integration event
/// lands a row at most once.
/// </summary>
public interface INotificationStore
{
    /// <summary>
    /// Persists <paramref name="notification"/> unless a row with the same
    /// <see cref="Notification.SourceEventId"/> already exists.
    /// </summary>
    /// <returns>
    /// <c>true</c> when newly stored — the caller should deliver it; <c>false</c> when it was a
    /// duplicate (already handled) — the caller must NOT re-deliver.
    /// </returns>
    Task<bool> TryAddAsync(Notification notification, CancellationToken cancellationToken = default);
}
