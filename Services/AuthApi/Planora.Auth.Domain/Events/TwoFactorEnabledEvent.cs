using Planora.BuildingBlocks.Domain;

namespace Planora.Auth.Domain.Events
{
    public sealed record TwoFactorEnabledEvent : DomainEvent
    {
        public Guid UserId { get; init; }

        public TwoFactorEnabledEvent(Guid userId)
        {
            UserId = userId;
        }
    }
}
