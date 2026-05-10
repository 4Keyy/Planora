using Planora.BuildingBlocks.Domain;

namespace Planora.Category.Domain.Events
{
    public sealed record CategorySetAsDefaultDomainEvent(
        Guid CategoryId,
        Guid UserId) : DomainEvent;
}
