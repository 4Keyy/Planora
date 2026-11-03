namespace Planora.BuildingBlocks.Application.Messaging;

public interface IEventBus
{
    Task PublishAsync<TEvent>(TEvent @event, CancellationToken cancellationToken = default)
        where TEvent : IntegrationEvent;

    /// <summary>Registers one stable logical subscriber. Replicas use the same ID; independent consumers use different IDs.</summary>
    Task SubscribeAsync<TEvent, THandler>(string subscriptionId, CancellationToken cancellationToken = default)
        where TEvent : IntegrationEvent
        where THandler : IIntegrationEventHandler<TEvent>;

    Task UnsubscribeAsync<TEvent, THandler>(string subscriptionId, CancellationToken cancellationToken = default)
        where TEvent : IntegrationEvent
        where THandler : IIntegrationEventHandler<TEvent>;
}
