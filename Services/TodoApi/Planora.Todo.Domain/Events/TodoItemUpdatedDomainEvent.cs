using Planora.BuildingBlocks.Domain;

namespace Planora.Todo.Domain.Events
{
    public sealed record TodoItemUpdatedDomainEvent(
        Guid TodoItemId,
        Guid UserId,
        string Title) : DomainEvent;
}
