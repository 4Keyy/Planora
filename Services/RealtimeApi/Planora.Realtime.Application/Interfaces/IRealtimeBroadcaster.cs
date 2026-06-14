namespace Planora.Realtime.Application.Interfaces
{
    /// <summary>
    /// Pushes live data-sync signals over SignalR. The Infrastructure implementation targets the
    /// hub groups directly (<c>user:{id}</c> for the feed, <c>task:{id}</c> for a branch room).
    /// Every payload is a thin signal (ids + action) — the client refetches through the normal
    /// authorized endpoints to reconcile, so a signal can never leak content the user may not read.
    /// </summary>
    public interface IRealtimeBroadcaster
    {
        /// <summary>
        /// Notifies each recipient's task list / dashboard that a task they can see changed.
        /// Sent to the <c>user:{id}</c> group for every id in <paramref name="userIds"/>.
        /// </summary>
        Task FeedChangedAsync(
            IReadOnlyList<Guid> userIds,
            string action,
            Guid taskId,
            Guid actorId,
            CancellationToken cancellationToken = default);

        /// <summary>
        /// Notifies everyone currently viewing a task's branch room that its content changed
        /// (a comment, subtask, status, or activity entry). Sent to the <c>task:{id}</c> group.
        /// </summary>
        Task BranchChangedAsync(
            Guid branchTaskId,
            string action,
            Guid entityId,
            Guid actorId,
            CancellationToken cancellationToken = default);
    }
}
