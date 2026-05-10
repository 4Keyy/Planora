using Planora.BuildingBlocks.Domain;

namespace Planora.Category.Domain.Events
{
    public sealed record CategoryDeletedDomainEvent(
        Guid CategoryId,
        Guid UserId) : DomainEvent;
}

