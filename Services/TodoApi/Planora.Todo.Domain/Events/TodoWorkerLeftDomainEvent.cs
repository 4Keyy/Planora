using Planora.BuildingBlocks.Domain;

namespace Planora.Todo.Domain.Events
{
    public sealed record TodoWorkerLeftDomainEvent(
        Guid TodoItemId,
        Guid WorkerUserId) : DomainEvent;
}
