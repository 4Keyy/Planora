namespace Planora.BuildingBlocks.Application.Messaging.Events
{
    public sealed class PasswordChangedIntegrationEvent : IntegrationEvent
    {
        public Guid UserId { get; set; }

        public PasswordChangedIntegrationEvent(Guid userId)
            : base()
        {
            UserId = userId;
        }
    }
}

