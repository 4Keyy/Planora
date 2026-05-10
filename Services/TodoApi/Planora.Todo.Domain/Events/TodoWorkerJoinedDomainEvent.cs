using Planora.BuildingBlocks.Domain;

namespace Planora.Todo.Domain.Events
{
    public sealed record TodoWorkerJoinedDomainEvent(
        Guid TodoItemId,
        Guid WorkerUserId) : DomainEvent;
}
