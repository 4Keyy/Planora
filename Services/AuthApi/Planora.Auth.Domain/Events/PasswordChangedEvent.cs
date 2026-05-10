using Planora.BuildingBlocks.Domain;

namespace Planora.Auth.Domain.Events
{
    public sealed record PasswordChangedEvent : DomainEvent
    {
        public Guid UserId { get; init; }
        public string Email { get; init; }

        public PasswordChangedEvent(Guid userId, string email)
        {
            UserId = userId;
            Email = email;
        }
    }
}
