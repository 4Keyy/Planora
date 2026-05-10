using Planora.BuildingBlocks.Domain;

namespace Planora.Todo.Domain.Events
{
    public sealed record TodoItemCategoryChangedDomainEvent(
        Guid TodoItemId,
        Guid UserId,
        Guid? CategoryId) : DomainEvent;
}
