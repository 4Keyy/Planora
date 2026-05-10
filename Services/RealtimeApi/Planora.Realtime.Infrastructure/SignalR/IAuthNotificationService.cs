namespace Planora.Realtime.Infrastructure.SignalR
{
    public interface IAuthNotificationService
    {
        Task NotifyNewLoginAsync(Guid userId, string device, string location);
        Task NotifyPasswordChangedAsync(Guid userId);
        Task NotifyAccountLockedAsync(Guid userId, DateTime lockedUntil);
        Task NotifyForceLogoutAsync(Guid userId, string reason);
        Task NotifySuspiciousActivityAsync(Guid userId, string activityDescription);
    }
}
