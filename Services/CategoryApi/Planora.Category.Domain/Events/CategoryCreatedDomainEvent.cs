using Planora.BuildingBlocks.Domain;

namespace Planora.Category.Domain.Events
{
    public sealed record CategoryCreatedDomainEvent(
        Guid CategoryId,
        Guid UserId,
        string Name,
        bool IsDefault) : DomainEvent;
}
