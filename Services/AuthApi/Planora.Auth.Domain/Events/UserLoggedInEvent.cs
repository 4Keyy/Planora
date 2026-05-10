using Planora.BuildingBlocks.Domain;

namespace Planora.Auth.Domain.Events
{
    public sealed record UserLoggedInEvent : DomainEvent
    {
        public Guid UserId { get; init; }
        public string Email { get; init; }
        public string IpAddress { get; init; }

        public UserLoggedInEvent(Guid userId, string email, string ipAddress)
        {
            UserId = userId;
            Email = email;
            IpAddress = ipAddress;
        }
    }
}
