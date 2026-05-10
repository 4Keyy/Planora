namespace Planora.BuildingBlocks.Infrastructure
{
    public sealed class DomainEventDispatcher : IDomainEventDispatcher
    {
        private readonly IPublisher _publisher;
        private readonly ILogger<DomainEventDispatcher> _logger;

        public DomainEventDispatcher(
            IPublisher publisher,
            ILogger<DomainEventDispatcher> logger)
        {
            _publisher = publisher;
            _logger = logger;
        }

        public async Task DispatchAsync(
            IDomainEvent domainEvent,
            CancellationToken cancellationToken = default)
        {
            try
            {
                var notificationType = typeof(DomainEventNotification<>).MakeGenericType(domainEvent.GetType());
                var notification = (INotification)Activator.CreateInstance(notificationType, domainEvent)!;

                await _publisher.Publish(notification, cancellationToken);
                _logger.LogInformation(
                    "📤 Domain event dispatched: {EventType}, EventId: {EventId}",
                    domainEvent.EventType, domainEvent.EventId);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex,
                    "❌ Error dispatching domain event: {EventType}",
                    domainEvent.EventType);
                throw;
            }
        }
    }

    public interface IDomainEventDispatcher
    {
        Task DispatchAsync(IDomainEvent domainEvent, CancellationToken cancellationToken = default);
    }

    public class DomainEventNotification<TDomainEvent> : INotification where TDomainEvent : IDomainEvent
    {
        public TDomainEvent DomainEvent { get; }

        public DomainEventNotification(TDomainEvent domainEvent)
        {
            DomainEvent = domainEvent;
        }
    }
}
