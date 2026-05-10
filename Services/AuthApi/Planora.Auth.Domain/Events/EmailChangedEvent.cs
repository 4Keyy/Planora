using Planora.BuildingBlocks.Domain;

namespace Planora.Auth.Domain.Events
{
    public sealed record EmailChangedEvent : DomainEvent
    {
        public Guid UserId { get; init; }
        public string OldEmail { get; init; }
        public string NewEmail { get; init; }

        public EmailChangedEvent(Guid userId, string oldEmail, string newEmail)
        {
            UserId = userId;
            OldEmail = oldEmail;
            NewEmail = newEmail;
        }
    }
}
