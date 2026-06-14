using Microsoft.AspNetCore.SignalR;
using Planora.Realtime.Application.Interfaces;
using Planora.Realtime.Infrastructure.Hubs;

namespace Planora.Realtime.Infrastructure.Services
{
    /// <summary>
    /// SignalR implementation of <see cref="IRealtimeBroadcaster"/>. Pushes data-sync signals
    /// through the unified hub's group routing. The Redis backplane (configured in Program) makes
    /// these group sends fan out across every RealtimeApi instance, so a recipient connected to a
    /// different node still receives the push.
    /// </summary>
    public sealed class RealtimeBroadcaster : IRealtimeBroadcaster
    {
        private readonly IHubContext<NotificationHub> _hubContext;
        private readonly ILogger<RealtimeBroadcaster> _logger;

        public RealtimeBroadcaster(
            IHubContext<NotificationHub> hubContext,
            ILogger<RealtimeBroadcaster> logger)
        {
            _hubContext = hubContext;
            _logger = logger;
        }

        public async Task FeedChangedAsync(
            IReadOnlyList<Guid> userIds,
            string action,
            Guid taskId,
            Guid actorId,
            CancellationToken cancellationToken = default)
        {
            if (userIds is null || userIds.Count == 0)
                return;

            // De-dupe and address each recipient's personal group. We could batch with a single
            // Clients.Groups(...) call, but the per-user group names are derived locally and the
            // recipient counts here are small (a user's friends + shared-with set), so the explicit
            // loop keeps the log line per recipient without measurable overhead.
            var groups = userIds
                .Where(id => id != Guid.Empty)
                .Distinct()
                .Select(id => $"user:{id}")
                .ToArray();

            if (groups.Length == 0)
                return;

            var payload = new
            {
                action,
                taskId,
                actorId,
                timestamp = DateTime.UtcNow,
            };

            await _hubContext.Clients.Groups(groups).SendAsync("TaskFeedChanged", payload, cancellationToken);

            _logger.LogDebug(
                "📡 TaskFeedChanged '{Action}' for task {TaskId} fanned out to {Count} recipient group(s)",
                action, taskId, groups.Length);
        }

        public async Task BranchChangedAsync(
            Guid branchTaskId,
            string action,
            Guid entityId,
            Guid actorId,
            CancellationToken cancellationToken = default)
        {
            if (branchTaskId == Guid.Empty)
                return;

            var payload = new
            {
                action,
                taskId = branchTaskId,
                entityId,
                actorId,
                timestamp = DateTime.UtcNow,
            };

            await _hubContext.Clients
                .Group($"task:{branchTaskId}")
                .SendAsync("BranchChanged", payload, cancellationToken);

            _logger.LogDebug(
                "📡 BranchChanged '{Action}' pushed to branch room task:{TaskId}",
                action, branchTaskId);
        }
    }
}
