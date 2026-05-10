using Planora.BuildingBlocks.Domain;

namespace Planora.Auth.Domain.Events
{
    public sealed record UserDeactivatedEvent : DomainEvent
    {
        public Guid UserId { get; init; }
        public string Email { get; init; }

        public UserDeactivatedEvent(Guid userId, string email)
        {
            UserId = userId;
            Email = email;
        }
    }
}
