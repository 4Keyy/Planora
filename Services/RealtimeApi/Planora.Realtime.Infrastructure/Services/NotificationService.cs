using Planora.Realtime.Infrastructure.Hubs;
using Planora.Realtime.Application.Interfaces;
using Planora.Realtime.Application.Response;

namespace Planora.Realtime.Infrastructure.Services
{
    public sealed class NotificationService : INotificationService
    {
        private readonly IHubContext<NotificationHub> _hubContext;
        private readonly ILogger<NotificationService> _logger;

        public NotificationService(
            IHubContext<NotificationHub> hubContext,
            ILogger<NotificationService> logger)
        {
            _hubContext = hubContext;
            _logger = logger;
        }

        public async Task SendToUserAsync(NotificationPayload payload, CancellationToken cancellationToken = default)
        {
            try
            {
                // The full persisted shape — id + task routing + read state — so the client renders
                // the toast, lights the right card/branch indicator and decides on an OS notification
                // without a follow-up fetch. The Redis backplane fans this out across every pod, so a
                // recipient connected to a different instance still receives it.
                await _hubContext.Clients
                    .Group($"user:{payload.UserId}")
                    .SendAsync("ReceiveNotification", Wire(payload), cancellationToken);

                _logger.LogInformation(
                    "Notification {NotificationId} ({Type}) pushed to user {UserId}",
                    payload.Id, payload.Type, payload.UserId);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to push notification {NotificationId} to user {UserId}", payload.Id, payload.UserId);
                throw;
            }
        }

        public async Task SendNotificationAsync(string userId, string message, string type, CancellationToken cancellationToken = default)
        {
            try
            {
                await _hubContext.Clients
                    .Group($"user:{userId}")
                    .SendAsync("ReceiveNotification", Wire(AdHoc(Guid.TryParse(userId, out var recipient) ? recipient : Guid.Empty, message, type)), cancellationToken);

                _logger.LogInformation("Notification sent to user {UserId}", userId);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to send notification to user {UserId}", userId);
                throw;
            }
        }

        public async Task SendToAllAsync(string message, string type, CancellationToken cancellationToken = default)
        {
            try
            {
                await _hubContext.Clients.All.SendAsync("ReceiveNotification", Wire(AdHoc(Guid.Empty, message, type)), cancellationToken);

                _logger.LogInformation("Broadcast notification sent");
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to send broadcast notification");
                throw;
            }
        }

        public async Task SendToGroupAsync(string groupName, string message, string type, CancellationToken cancellationToken = default)
        {
            try
            {
                await _hubContext.Clients.Group(groupName).SendAsync("ReceiveNotification", Wire(AdHoc(Guid.Empty, message, type)), cancellationToken);

                _logger.LogInformation("Notification sent to group {Group}", groupName);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to send notification to group {Group}", groupName);
                throw;
            }
        }

        /// <summary>
        /// The one shape <c>ReceiveNotification</c> carries — the client's <c>NotificationPayload</c>
        /// (<c>frontend/src/lib/realtime/client.ts</c>). Every sender used to build its own: the
        /// stored notifications named their time <c>occurredOn</c> instead of the canonical
        /// <c>occurredOnUtc</c>, and the ad-hoc ones sent only an id, a message, a type and a
        /// <c>timestamp</c>, so the client counted an unread notification with no title to show.
        /// </summary>
        private static object Wire(NotificationPayload payload) => new
        {
            id = payload.Id,
            userId = payload.UserId,
            taskId = payload.TaskId,
            actorId = payload.ActorId,
            type = payload.Type,
            title = payload.Title,
            message = payload.Message,
            occurredOnUtc = payload.OccurredOnUtc,
            isRead = payload.IsRead,
        };

        /// <summary>
        /// A notification that is not about a task and was not stored (the admin send endpoint and
        /// the gRPC broadcast): its text is the title, and the empty GUID stands for "no task" and
        /// "no actor", as it does everywhere else in the client.
        /// </summary>
        private static NotificationPayload AdHoc(Guid userId, string message, string type) =>
            new(Guid.NewGuid(), userId, Guid.Empty, Guid.Empty, type, message, string.Empty, DateTime.UtcNow, false);
    }
}
