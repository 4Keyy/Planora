using Planora.BuildingBlocks.Domain;

namespace Planora.Auth.Domain.Events
{
    public sealed record UserLockedEvent : DomainEvent
    {
        public Guid UserId { get; init; }
        public string Email { get; init; }
        public DateTime LockedUntil { get; init; }

        public UserLockedEvent(Guid userId, string email, DateTime lockedUntil)
        {
            UserId = userId;
            Email = email;
            LockedUntil = lockedUntil;
        }
    }
}
