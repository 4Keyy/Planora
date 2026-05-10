using Planora.BuildingBlocks.Domain;

namespace Planora.Auth.Domain.Events
{
    public sealed record AllRefreshTokensRevokedEvent : DomainEvent
    {
        public Guid UserId { get; init; }

        public AllRefreshTokensRevokedEvent(Guid userId)
        {
            UserId = userId;
        }
    }
}
