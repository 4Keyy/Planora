namespace Planora.BuildingBlocks.Infrastructure.Messaging.Events
{
    public sealed class UserDeletedIntegrationEvent : IntegrationEvent
    {
        public Guid UserId { get; init; }
        public string Email { get; init; }

        public UserDeletedIntegrationEvent(Guid userId, string email)
        {
            UserId = userId;
            Email = email;
        }
    }
}

