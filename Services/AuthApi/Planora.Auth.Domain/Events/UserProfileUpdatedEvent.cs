using Planora.BuildingBlocks.Domain;

namespace Planora.Auth.Domain.Events
{
    public sealed record UserProfileUpdatedEvent : DomainEvent
    {
        public Guid UserId { get; init; }

        public UserProfileUpdatedEvent(Guid userId)
        {
            UserId = userId;
        }
    }
}
