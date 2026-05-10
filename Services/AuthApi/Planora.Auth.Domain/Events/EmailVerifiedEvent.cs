using Planora.BuildingBlocks.Domain;

namespace Planora.Auth.Domain.Events
{
    public sealed record EmailVerifiedEvent : DomainEvent
    {
        public Guid UserId { get; init; }
        public string Email { get; init; }

        public EmailVerifiedEvent(Guid userId, string email)
        {
            UserId = userId;
            Email = email;
        }
    }
}
