using Planora.BuildingBlocks.Domain;

namespace Planora.Auth.Domain.Events
{
    public sealed record UserActivatedEvent : DomainEvent
    {
        public Guid UserId { get; init; }
        public string Email { get; init; }

        public UserActivatedEvent(Guid userId, string email)
        {
            UserId = userId;
            Email = email;
        }
    }
}
