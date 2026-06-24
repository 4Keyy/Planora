namespace Planora.Realtime.Application.Response;

/// <summary>
/// Per-type unread breakdown within a single task. Drives the card's notification badge cluster
/// ("Audi rings") — one disc per event type, newest first.
/// </summary>
public sealed record TaskUnreadGroup(string Type, int Count, DateTime LatestOccurredOnUtc);

/// <summary>
/// Unread notification count for a single task — drives a card's badge and a branch's badge.
/// <see cref="Count"/> and <see cref="LatestType"/> are kept for backward compatibility
/// (<c>LatestType == Groups[0].Type</c>); <see cref="Groups"/> carries the per-type breakdown,
/// ordered by <see cref="TaskUnreadGroup.LatestOccurredOnUtc"/> descending (newest first).
/// </summary>
public sealed record TaskUnread(Guid TaskId, int Count, string LatestType, IReadOnlyList<TaskUnreadGroup> Groups);

/// <summary>
/// The compact summary the client loads on startup and after each mark-read: the total unread count
/// (bell badge) plus the per-task unread breakdown (card dots + branch badges). One round trip backs
/// every inline indicator in the app.
/// </summary>
public sealed record NotificationSummary(int TotalUnread, IReadOnlyList<TaskUnread> PerTask)
{
    public static readonly NotificationSummary Empty = new(0, System.Array.Empty<TaskUnread>());
}
