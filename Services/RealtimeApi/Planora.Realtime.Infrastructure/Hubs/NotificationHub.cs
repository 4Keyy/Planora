using Planora.Realtime.Infrastructure.Services;
using Microsoft.AspNetCore.Authorization;

namespace Planora.Realtime.Infrastructure.Hubs
{
    [Authorize]
    public sealed class NotificationHub : Hub
    {
        private readonly ILogger<NotificationHub> _logger;
        private readonly IConnectionManager _connectionManager;

        public NotificationHub(
            ILogger<NotificationHub> logger,
            IConnectionManager connectionManager)
        {
            _logger = logger;
            _connectionManager = connectionManager;
        }

        public override async Task OnConnectedAsync()
        {
            var userId = Context.UserIdentifier;

            if (!string.IsNullOrEmpty(userId))
            {
                await Groups.AddToGroupAsync(Context.ConnectionId, $"user:{userId}");
                await _connectionManager.AddConnectionAsync(userId, Context.ConnectionId);

                _logger.LogInformation(
                    "✅ User {UserId} connected to SignalR (ConnectionId: {ConnectionId})",
                    userId,
                    Context.ConnectionId);
            }

            await base.OnConnectedAsync();
        }

        public override async Task OnDisconnectedAsync(Exception? exception)
        {
            var userId = Context.UserIdentifier;

            if (!string.IsNullOrEmpty(userId))
            {
                await Groups.RemoveFromGroupAsync(Context.ConnectionId, $"user:{userId}");
                await _connectionManager.RemoveConnectionAsync(userId, Context.ConnectionId);

                _logger.LogInformation(
                    "👋 User {UserId} disconnected from SignalR (ConnectionId: {ConnectionId})",
                    userId,
                    Context.ConnectionId);
            }

            await base.OnDisconnectedAsync(exception);
        }

        public async Task Subscribe(string notificationType)
        {
            await Groups.AddToGroupAsync(Context.ConnectionId, notificationType);
            _logger.LogInformation(
                "User subscribed to {NotificationType}",
                notificationType);
        }

        public async Task Unsubscribe(string notificationType)
        {
            await Groups.RemoveFromGroupAsync(Context.ConnectionId, notificationType);
            _logger.LogInformation(
                "User unsubscribed from {NotificationType}",
                notificationType);
        }
    }
}
