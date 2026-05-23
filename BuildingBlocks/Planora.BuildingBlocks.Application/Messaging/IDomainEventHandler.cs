using Planora.BuildingBlocks.Domain.Interfaces;

namespace Planora.BuildingBlocks.Application.Messaging
{
    public interface IDomainEventHandler<in TEvent> where TEvent : IDomainEvent
    {
        Task HandleAsync(TEvent domainEvent, CancellationToken cancellationToken = default);
    }
}
