using Planora.BuildingBlocks.Domain;

namespace Planora.Todo.Domain.Events
{
    public sealed record TodoItemCompletedDomainEvent(
        Guid TodoItemId,
        Guid UserId) : DomainEvent;
}
