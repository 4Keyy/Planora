namespace Planora.BuildingBlocks.Infrastructure.Messaging.Events
{
    public sealed class AccountLockedIntegrationEvent : IntegrationEvent
    {
        public Guid UserId { get; set; }
        public string Email { get; set; } = string.Empty;
        public DateTime LockedUntil { get; set; }
        public string Reason { get; set; } = string.Empty;

        public AccountLockedIntegrationEvent(Guid userId, string email, DateTime lockedUntil, string reason)
            : base()
        {
            UserId = userId;
            Email = email;
            LockedUntil = lockedUntil;
            Reason = reason;
        }
    }
}

