using Planora.BuildingBlocks.Domain;

namespace Planora.Auth.Domain.Events
{
    public sealed record TwoFactorDisabledEvent : DomainEvent
    {
        public Guid UserId { get; init; }

        public TwoFactorDisabledEvent(Guid userId)
        {
            UserId = userId;
        }
    }
}
