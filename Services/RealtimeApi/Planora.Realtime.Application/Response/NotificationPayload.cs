using Planora.Realtime.Domain.Entities;

namespace Planora.Realtime.Application.Response;

/// <summary>
/// The wire shape pushed to a client over SignalR (<c>ReceiveNotification</c>) and returned by the
/// notification list endpoint. A thin, self-contained record — it carries everything the frontend
/// needs to render the toast, route the unread dot/badge to a task, and decide whether to raise an
/// OS notification, without a follow-up fetch.
/// </summary>
public sealed record NotificationPayload(
    Guid Id,
    Guid UserId,
    Guid TaskId,
    Guid ActorId,
    string Type,
    string Title,
    string Message,
    DateTime OccurredOnUtc,
    bool IsRead)
{
    public static NotificationPayload From(Notification n) => new(
        n.Id,
        n.UserId,
        n.TaskId,
        n.ActorId,
        n.Type,
        n.Title,
        n.Message,
        n.OccurredOnUtc,
        n.IsRead);
}
