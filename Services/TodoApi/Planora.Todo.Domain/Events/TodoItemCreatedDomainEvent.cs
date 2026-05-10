using Planora.BuildingBlocks.Domain;

namespace Planora.Todo.Domain.Events
{
    public sealed record TodoItemCreatedDomainEvent(
        Guid TodoItemId,
        Guid UserId,
        string Title,
        Guid? CategoryId) : DomainEvent;
}
