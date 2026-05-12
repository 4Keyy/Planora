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

        // Allowed notification topic prefixes. The "user:" namespace is reserved for
        // per-user delivery and is managed exclusively by OnConnectedAsync/OnDisconnectedAsync
        // using the caller's own verified user ID from their JWT. Clients cannot subscribe
        // to "user:{other_user_id}" because that group is never exposed here.
        private static readonly IReadOnlySet<string> AllowedTopics =
            new HashSet<string>(StringComparer.OrdinalIgnoreCase)
            {
                "system",
                "announcements",
                "todos",
            };

        public async Task Subscribe(string notificationType)
        {
            // SECURITY: Only allow subscription to pre-approved broadcast topics.
            // The "user:{userId}" group is managed by the hub itself (OnConnected/Disconnected)
            // and must never be exposed as a client-controllable subscription target —
            // otherwise any authenticated user could subscribe to another user's group.
            if (!AllowedTopics.Contains(notificationType))
            {
                _logger.LogWarning(
                    "User {UserId} attempted to subscribe to disallowed topic {Topic}",
                    Context.UserIdentifier,
                    notificationType);
                return;
            }

            await Groups.AddToGroupAsync(Context.ConnectionId, notificationType);
            _logger.LogInformation(
                "User subscribed to {NotificationType}",
                notificationType);
        }

        public async Task Unsubscribe(string notificationType)
        {
            if (!AllowedTopics.Contains(notificationType))
            {
                return;
            }

            await Groups.RemoveFromGroupAsync(Context.ConnectionId, notificationType);
            _logger.LogInformation(
                "User unsubscribed from {NotificationType}",
                notificationType);
        }
    }
}
