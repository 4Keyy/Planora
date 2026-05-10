namespace Planora.BuildingBlocks.Infrastructure.Messaging.Events
{
    public sealed class EmailVerifiedIntegrationEvent : IntegrationEvent
    {
        public Guid UserId { get; init; }
        public string Email { get; init; }

        public EmailVerifiedIntegrationEvent(Guid userId, string email)
        {
            UserId = userId;
            Email = email;
        }
    }
}

