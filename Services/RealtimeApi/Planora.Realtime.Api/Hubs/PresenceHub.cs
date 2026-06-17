using System.Security.Claims;

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

        /// <summary>
        /// Resolves the caller's id from the JWT. The default inbound claim mapping remaps the
        /// token's <c>sub</c> to <see cref="ClaimTypes.NameIdentifier"/>, so both must be checked —
        /// reading only <c>sub</c> yields null and silently disables every presence broadcast.
        /// </summary>
        private string? GetUserId() =>
            Context.User?.FindFirst("sub")?.Value
            ?? Context.User?.FindFirst(ClaimTypes.NameIdentifier)?.Value;

        public override async Task OnConnectedAsync()
        {
            var userId = GetUserId();
            if (!string.IsNullOrEmpty(userId))
            {
                await Clients.Others.SendAsync("UserConnected", userId);
                _logger.LogInformation("User {UserId} is now online", userId);
            }

            await base.OnConnectedAsync();
        }

        public override async Task OnDisconnectedAsync(Exception? exception)
        {
            var userId = GetUserId();
            if (!string.IsNullOrEmpty(userId))
            {
                await Clients.Others.SendAsync("UserDisconnected", userId);
                _logger.LogInformation("User {UserId} is now offline", userId);
            }

            await base.OnDisconnectedAsync(exception);
        }

        // Allowed presence states. The client cannot broadcast arbitrary strings — an
        // unbounded value would let one client push large payloads to every other client.
        private static readonly HashSet<string> AllowedStatuses =
            new(StringComparer.OrdinalIgnoreCase) { "online", "away", "busy", "offline" };

        public async Task UpdateStatus(string status)
        {
            var userId = GetUserId();
            if (string.IsNullOrEmpty(userId))
                return;

            if (string.IsNullOrWhiteSpace(status) || !AllowedStatuses.Contains(status))
                throw new HubException("Invalid status");

            await Clients.Others.SendAsync("UserStatusChanged", userId, status);
            _logger.LogInformation("User {UserId} status changed to {Status}", userId, status);
        }
    }
}
