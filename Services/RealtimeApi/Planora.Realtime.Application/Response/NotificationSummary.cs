namespace Planora.Realtime.Application.Response;

/// <summary>Unread notification count for a single task — drives a card's dot and a branch's badge.</summary>
public sealed record TaskUnread(Guid TaskId, int Count, string LatestType);

/// <summary>
/// The compact summary the client loads on startup and after each mark-read: the total unread count
/// (bell badge) plus the per-task unread breakdown (card dots + branch badges). One round trip backs
/// every inline indicator in the app.
/// </summary>
public sealed record NotificationSummary(int TotalUnread, IReadOnlyList<TaskUnread> PerTask)
{
    public static readonly NotificationSummary Empty = new(0, System.Array.Empty<TaskUnread>());
}
