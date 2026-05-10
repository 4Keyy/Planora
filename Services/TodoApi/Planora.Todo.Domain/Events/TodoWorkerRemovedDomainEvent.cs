using Planora.BuildingBlocks.Domain;

namespace Planora.Todo.Domain.Events
{
    public sealed record TodoWorkerRemovedDomainEvent(
        Guid TodoItemId,
        Guid WorkerUserId) : DomainEvent;
}
