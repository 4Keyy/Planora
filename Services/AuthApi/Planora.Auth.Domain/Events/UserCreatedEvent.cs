using Planora.BuildingBlocks.Domain;

namespace Planora.Auth.Domain.Events
{
    public sealed record UserCreatedEvent : DomainEvent
    {
        public Guid UserId { get; init; }
        public string Email { get; init; }
        public string FirstName { get; init; }
        public string LastName { get; init; }

        public UserCreatedEvent(Guid userId, string email, string firstName, string lastName)
        {
            UserId = userId;
            Email = email;
            FirstName = firstName;
            LastName = lastName;
        }
    }
}
