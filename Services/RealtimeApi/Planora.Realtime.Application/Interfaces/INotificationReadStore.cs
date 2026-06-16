using Planora.Realtime.Application.Response;

namespace Planora.Realtime.Application.Interfaces;

/// <summary>
/// Read side of the durable notification log. Every method is scoped to a single recipient — the
/// caller passes the authenticated user id from the JWT, never a client-supplied one, so a user can
/// only ever see or mutate their own notifications (no IDOR surface).
/// </summary>
public interface INotificationReadStore
{
    /// <summary>Total unread + per-task unread breakdown for <paramref name="userId"/>.</summary>
    Task<NotificationSummary> GetSummaryAsync(Guid userId, CancellationToken cancellationToken = default);

    /// <summary>
    /// A page of the user's notifications, newest first. <paramref name="before"/> is a keyset cursor
    /// (the OccurredOn of the last row seen) for cheap "load older" paging.
    /// </summary>
    Task<IReadOnlyList<NotificationPayload>> GetListAsync(
        Guid userId, int take, DateTime? before, CancellationToken cancellationToken = default);

    /// <summary>
    /// Marks the user's matching unread notifications read and returns the fresh summary.
    /// Exactly one selector applies, in priority order: <paramref name="all"/> →
    /// <paramref name="taskId"/> → <paramref name="ids"/>. Idempotent — already-read rows are
    /// untouched.
    /// </summary>
    Task<NotificationSummary> MarkReadAsync(
        Guid userId,
        bool all,
        Guid? taskId,
        IReadOnlyList<Guid>? ids,
        CancellationToken cancellationToken = default);
}
