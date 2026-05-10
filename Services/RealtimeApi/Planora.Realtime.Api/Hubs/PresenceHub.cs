namespace Planora.Realtime.Api.Hubs
{
    [Authorize]
    public sealed class PresenceHub : Hub
    {
        private readonly ILogger<PresenceHub> _logger;

        public PresenceHub(ILogger<PresenceHub> logger)
        {
            _logger = logger;
        }

        public override async Task OnConnectedAsync()
        {
            var userId = Context.User?.FindFirst("sub")?.Value;
            if (!string.IsNullOrEmpty(userId))
            {
                await Clients.Others.SendAsync("UserConnected", userId);
                _logger.LogInformation("User {UserId} is now online", userId);
            }

            await base.OnConnectedAsync();
        }

        public override async Task OnDisconnectedAsync(Exception? exception)
        {
            var userId = Context.User?.FindFirst("sub")?.Value;
            if (!string.IsNullOrEmpty(userId))
            {
                await Clients.Others.SendAsync("UserDisconnected", userId);
                _logger.LogInformation("User {UserId} is now offline", userId);
            }

            await base.OnDisconnectedAsync(exception);
        }

        public async Task UpdateStatus(string status)
        {
            var userId = Context.User?.FindFirst("sub")?.Value;
            if (!string.IsNullOrEmpty(userId))
            {
                await Clients.Others.SendAsync("UserStatusChanged", userId, status);
                _logger.LogInformation("User {UserId} status changed to {Status}", userId, status);
            }
        }
    }
}
