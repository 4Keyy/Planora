namespace Planora.BuildingBlocks.Infrastructure.Messaging.Events
{
    public sealed class UserRegisteredIntegrationEvent : IntegrationEvent
    {
        public Guid UserId { get; set; }
        public string Email { get; set; } = string.Empty;
        public string FirstName { get; set; } = string.Empty;
        public string LastName { get; set; } = string.Empty;

        public UserRegisteredIntegrationEvent(Guid userId, string email, string firstName, string lastName)
            : base()
        {
            UserId = userId;
            Email = email;
            FirstName = firstName;
            LastName = lastName;
        }
    }
}

