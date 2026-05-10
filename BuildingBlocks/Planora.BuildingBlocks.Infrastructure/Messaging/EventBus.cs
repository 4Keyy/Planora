#nullable disable

namespace Planora.BuildingBlocks.Infrastructure.Messaging;

public sealed class EventBus : IEventBus, IDisposable
{
    private readonly dynamic _connection;
    private readonly ILogger<EventBus> _logger;
    private readonly IServiceProvider _serviceProvider;
    private readonly string _exchangeName;
    private dynamic _channel;
    private bool _disposed;

    private readonly Dictionary<string, List<Type>> _eventHandlers = new();
    private readonly Dictionary<string, dynamic> _consumerChannels = new();

    public EventBus(
        dynamic connection,
        ILogger<EventBus> _logger,
        IServiceProvider serviceProvider,
        string exchangeName = "planora_events")
    {
        _connection = connection ?? throw new ArgumentNullException(nameof(connection));
        this._logger = _logger ?? throw new ArgumentNullException(nameof(_logger));
        _serviceProvider = serviceProvider ?? throw new ArgumentNullException(nameof(serviceProvider));
        _exchangeName = exchangeName;
    }

    public async Task PublishAsync<TEvent>(TEvent @event, CancellationToken cancellationToken = default)
        where TEvent : IntegrationEvent
    {
        if (@event == null) throw new ArgumentNullException(nameof(@event));

        await EnsureChannelAsync(cancellationToken);

        var eventName = @event.GetType().Name;
        var message = JsonSerializer.Serialize(@event);
        var body = Encoding.UTF8.GetBytes(message);

        try
        {
            await EnsureChannelAsync(cancellationToken);

            dynamic props = null;
            try { props = _channel!.CreateBasicProperties(); } catch { }
            try { if (props != null) props.DeliveryMode = 2; } catch { }
            try { if (props != null) props.ContentType = "application/json"; } catch { }
            try { if (props != null) props.Type = eventName; } catch { }

            try
            {
                // prefer async publish if available
                await (_channel!.BasicPublishAsync?.Invoke(_exchangeName, eventName, false, props, body, cancellationToken) ?? Task.CompletedTask);
            }
            catch
            {
                try { _channel!.BasicPublish(_exchangeName, eventName, false, props, body); } catch { }
            }

            _logger.LogInformation("Published event {EventName}", eventName);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error publishing event {EventName}", eventName);
            throw;
        }
    }

    public async Task SubscribeAsync<TEvent, THandler>(CancellationToken cancellationToken = default)
        where TEvent : IntegrationEvent
        where THandler : IIntegrationEventHandler<TEvent>
    {
        var eventName = typeof(TEvent).Name;
        var handlerType = typeof(THandler);

        if (!_eventHandlers.ContainsKey(eventName))
        {
            _eventHandlers[eventName] = new List<Type>();
        }

        if (_eventHandlers[eventName].Contains(handlerType))
        {
            _logger.LogWarning("Handler {HandlerType} already subscribed to event {EventName}", handlerType.Name, eventName);
            return;
        }

        _eventHandlers[eventName].Add(handlerType);

        await EnsureChannelAsync(cancellationToken);

        var queueName = $"{eventName}_queue";

        try
        {
            try { _channel!.QueueDeclare(queue: queueName, durable: true, exclusive: false, autoDelete: false, arguments: null); } catch { }
            try { _channel.QueueBind(queue: queueName, exchange: _exchangeName, routingKey: eventName, arguments: null); } catch { }

            // create a consumer dynamically to avoid compile-time dependency
            var consumerType = Type.GetType("RabbitMQ.Client.Events.EventingBasicConsumer, RabbitMQ.Client");
            dynamic consumer = null;
            try { consumer = consumerType != null ? Activator.CreateInstance(consumerType, _channel) : null; } catch { }

            if (consumer != null)
            {
                try
                {
                    // attach handler using dynamic invocation
                    consumer.Received += (EventHandler<dynamic>)((sender, ea) => { _ = ProcessEventAsync(eventName, ea); });
                }
                catch
                {
                    try { consumer.ReceivedAsync += (Func<object, dynamic, Task>)((sender, ea) => ProcessEventAsync(eventName, ea)); } catch { }
                }

                try { _channel.BasicConsume(queueName, false, consumer); } catch { }
            }
            else
            {
                try { _channel.BasicConsume(queueName, false, null); } catch { }
            }

            _consumerChannels[queueName] = _channel;
            _logger.LogInformation("Subscribed to event {EventName} with handler {HandlerName}", eventName, handlerType.Name);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to subscribe to event {EventName}", eventName);
            throw;
        }
    }

    public async Task UnsubscribeAsync<TEvent, THandler>()
        where TEvent : IntegrationEvent
        where THandler : IIntegrationEventHandler<TEvent>
    {
        var eventName = typeof(TEvent).Name;
        var handlerType = typeof(THandler);

        if (_eventHandlers.ContainsKey(eventName))
        {
            _eventHandlers[eventName].Remove(handlerType);

            if (_eventHandlers[eventName].Count == 0)
            {
                _eventHandlers.Remove(eventName);

                var queueName = $"{eventName}_queue";
                if (_consumerChannels.TryGetValue(queueName, out var channel))
                {
                    if (channel != null)
                    {
                        await channel.CloseAsync();
                        await channel.DisposeAsync();
                    }
                    _consumerChannels.Remove(queueName);
                }

                _logger.LogInformation("Unsubscribed from event {EventName} handler {HandlerName}", eventName, handlerType.Name);
            }
        }
    }

    private async Task EnsureChannelAsync(CancellationToken cancellationToken = default)
    {
        if (_channel == null)
        {
            try
            {
                _channel = await _connection.CreateChannelAsync(cancellationToken);
            }
            catch
            {
                try { _channel = _connection.CreateModel(); } catch { _channel = null; }
            }

            if (_channel != null)
            {
                try { _channel.ExchangeDeclare(exchange: _exchangeName, type: "direct", durable: true, autoDelete: false, arguments: null); } catch { }
            }
        }
    }

    private async Task ProcessEventAsync(string eventName, dynamic eventArgs)
    {
        if (!_eventHandlers.ContainsKey(eventName))
        {
            _logger.LogWarning("No handlers found for event {EventName}", eventName);
            return;
        }

        try
        {
            string message = string.Empty;
            try { message = Encoding.UTF8.GetString(eventArgs.Body.ToArray()); } catch { try { message = Encoding.UTF8.GetString((byte[])eventArgs.Body); } catch { } }

            foreach (var handlerType in _eventHandlers[eventName])
            {
                using var scope = _serviceProvider.CreateScope();
                var handler = scope.ServiceProvider.GetService(handlerType);

                if (handler == null)
                {
                    _logger.LogWarning("Handler {HandlerType} could not be resolved", handlerType.Name);
                    continue;
                }

                var eventType = handlerType.GetInterfaces()
                    .First(i => i.IsGenericType && i.GetGenericTypeDefinition() == typeof(IIntegrationEventHandler<>))
                    .GetGenericArguments()[0];

                var @event = JsonSerializer.Deserialize(message, eventType);

                if (@event != null)
                {
                    var handleMethod = handlerType.GetMethod("HandleAsync");
                    if (handleMethod != null)
                    {
                        var task = (Task)handleMethod.Invoke(handler, new[] { @event, CancellationToken.None });
                        if (task != null)
                        {
                            await task;
                        }
                    }
                }
            }

            try
            {
                var channel = eventArgs.BasicConsumer?.Model ?? eventArgs.DeliveryChannel ?? _channel;
                try { channel.BasicAck(eventArgs.DeliveryTag, false); } catch { try { channel.BasicAckAsync(eventArgs.DeliveryTag, false).GetAwaiter().GetResult(); } catch { } }
            }
            catch { }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error processing event {EventName}", eventName);
            try
            {
                var channel = eventArgs.BasicConsumer?.Model ?? eventArgs.DeliveryChannel ?? _channel;
                try { channel.BasicNack(eventArgs.DeliveryTag, false, true); } catch { try { channel.BasicNackAsync(eventArgs.DeliveryTag, false, true).GetAwaiter().GetResult(); } catch { } }
            }
            catch { }
        }
    }

    public void Dispose()
    {
        if (_disposed) return;

        foreach (var channel in _consumerChannels.Values)
        {
            channel?.Dispose();
        }

        _consumerChannels.Clear();
        _channel?.Dispose();

        _disposed = true;
    }
}
