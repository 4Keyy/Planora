namespace Planora.BuildingBlocks.Infrastructure.Messaging
{
    public sealed class DomainEventDispatcher : IDomainEventDispatcher
    {
        private readonly IServiceProvider _serviceProvider;
        private readonly ILogger<DomainEventDispatcher> _logger;

        public DomainEventDispatcher(
            IServiceProvider serviceProvider,
            ILogger<DomainEventDispatcher> logger)
        {
            _serviceProvider = serviceProvider;
            _logger = logger;
        }

        public async Task DispatchAsync(
            IDomainEvent domainEvent,
            CancellationToken cancellationToken = default)
        {
            if (domainEvent is null)
            {
                throw new ArgumentNullException(nameof(domainEvent));
            }

            _logger.LogDebug(
                "Dispatching domain event {EventType} with ID {EventId}",
                domainEvent.EventType,
                domainEvent.EventId);

            var eventType = domainEvent.GetType();
            var handlerType = typeof(IDomainEventHandler<>).MakeGenericType(eventType);

            using var scope = _serviceProvider.CreateScope();
            var handlers = scope.ServiceProvider.GetServices(handlerType);

            var handlersList = handlers.ToList();

            if (!handlersList.Any())
            {
                _logger.LogWarning(
                    "No handlers found for domain event {EventType}",
                    domainEvent.EventType);
                return;
            }

            foreach (var handler in handlersList)
            {
                if (handler is null)
                {
                    _logger.LogWarning("A null handler instance was resolved for event {EventType}", domainEvent.EventType ?? eventType.Name);
                    continue;
                }
                try
                {
                    var handleMethod = handlerType.GetMethod(nameof(IDomainEventHandler<IDomainEvent>.HandleAsync));
                    if (handleMethod != null)
                    {
                        var invoked = handleMethod.Invoke(handler, new object[] { domainEvent, cancellationToken });
                        if (invoked is Task task)
                        {
                            await task;

                            _logger.LogDebug(
                                "Successfully handled domain event {EventType} with handler {HandlerType}",
                                domainEvent.EventType ?? eventType.Name,
                                handler.GetType().Name);
                        }
                        else
                        {
                            _logger.LogWarning(
                                "Handler method for {HandlerType} did not return a Task",
                                handler.GetType().Name);
                        }
                    }
                }
                catch (Exception ex)
                {
                    _logger.LogError(
                        ex,
                        "Error handling domain event {EventType} with handler {HandlerType}",
                        domainEvent.EventType ?? eventType.Name,
                        handler.GetType().Name);

                    throw;
                }
            }
        }

        public async Task DispatchAsync(
            IEnumerable<IDomainEvent> domainEvents,
            CancellationToken cancellationToken = default)
        {
            foreach (var domainEvent in domainEvents)
            {
                await DispatchAsync(domainEvent, cancellationToken);
            }
        }
    }
}
