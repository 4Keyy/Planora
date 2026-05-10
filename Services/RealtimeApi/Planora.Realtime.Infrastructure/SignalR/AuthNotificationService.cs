using Planora.Realtime.Infrastructure.Hubs;

namespace Planora.Realtime.Infrastructure.SignalR
{
    public sealed class AuthNotificationService : IAuthNotificationService
    {
        private readonly IHubContext<NotificationHub> _hubContext;
        private readonly ILogger<AuthNotificationService> _logger;

        public AuthNotificationService(
            IHubContext<NotificationHub> hubContext,
            ILogger<AuthNotificationService> logger)
        {
            _hubContext = hubContext;
            _logger = logger;
        }

        public async Task NotifyNewLoginAsync(Guid userId, string device, string location)
        {
            await _hubContext.Clients
                .Group($"user:{userId}")
                .SendAsync("NewLogin", new
                {
                    Device = device,
                    Location = location,
                    Timestamp = DateTime.UtcNow
                });

            _logger.LogInformation(
                "🔔 Sent new login notification to user: {UserId}",
                userId);
        }

        public async Task NotifyPasswordChangedAsync(Guid userId)
        {
            await _hubContext.Clients
                .Group($"user:{userId}")
                .SendAsync("PasswordChanged", new
                {
                    Timestamp = DateTime.UtcNow,
                    Message = "Your password has been changed. All sessions have been logged out."
                });

            _logger.LogInformation(
                "🔔 Sent password changed notification to user: {UserId}",
                userId);
        }

        public async Task NotifyAccountLockedAsync(Guid userId, DateTime lockedUntil)
        {
            await _hubContext.Clients
                .Group($"user:{userId}")
                .SendAsync("AccountLocked", new
                {
                    LockedUntil = lockedUntil,
                    Message = "Your account has been temporarily locked due to multiple failed login attempts."
                });

            _logger.LogInformation(
                "🔔 Sent account locked notification to user: {UserId}",
                userId);
        }

        public async Task NotifyForceLogoutAsync(Guid userId, string reason)
        {
            await _hubContext.Clients
                .Group($"user:{userId}")
                .SendAsync("ForceLogout", new
                {
                    Reason = reason,
                    Timestamp = DateTime.UtcNow
                });

            _logger.LogInformation(
                "🔔 Sent force logout notification to user: {UserId}, Reason: {Reason}",
                userId,
                reason);
        }

        public async Task NotifySuspiciousActivityAsync(Guid userId, string activityDescription)
        {
            await _hubContext.Clients
                .Group($"user:{userId}")
                .SendAsync("SuspiciousActivity", new
                {
                    Description = activityDescription,
                    Timestamp = DateTime.UtcNow,
                    Severity = "High"
                });

            _logger.LogInformation(
                "🔔 Sent suspicious activity notification to user: {UserId}",
                userId);
        }
    }
}
