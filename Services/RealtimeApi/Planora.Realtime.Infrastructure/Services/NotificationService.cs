using Planora.Realtime.Infrastructure.Hubs;
using Planora.Realtime.Application.Interfaces;

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

        public async Task SendNotificationAsync(string userId, string message, string type, CancellationToken cancellationToken = default)
        {
            try
            {
                await _hubContext.Clients
                    .Group($"user:{userId}")
                    .SendAsync("ReceiveNotification", new
                    {
                        id = Guid.NewGuid(),
                        message,
                        type,
                        timestamp = DateTime.UtcNow
                    }, cancellationToken);

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
                await _hubContext.Clients.All.SendAsync("ReceiveNotification", new
                {
                    id = Guid.NewGuid(),
                    message,
                    type,
                    timestamp = DateTime.UtcNow
                }, cancellationToken);

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
                await _hubContext.Clients.Group(groupName).SendAsync("ReceiveNotification", new
                {
                    id = Guid.NewGuid(),
                    message,
                    type,
                    timestamp = DateTime.UtcNow
                }, cancellationToken);

                _logger.LogInformation("Notification sent to group {Group}", groupName);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to send notification to group {Group}", groupName);
                throw;
            }
        }
    }
}
