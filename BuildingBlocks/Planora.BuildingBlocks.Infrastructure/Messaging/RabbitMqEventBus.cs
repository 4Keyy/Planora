using RabbitMQ.Client;
using RabbitMQ.Client.Events;

namespace Planora.BuildingBlocks.Infrastructure.Messaging;

public sealed class RabbitMqEventBus : IEventBus, IDisposable
{
    private readonly IRabbitMqConnectionManager _connectionManager;
    private readonly ILogger<RabbitMqEventBus> _logger;
    private readonly IServiceProvider _serviceProvider;
    private readonly Dictionary<string, List<Type>> _eventHandlers = new();
    private readonly Dictionary<string, RabbitMQ.Client.IChannel> _consumerChannels = new();
    private const string ExchangeName = "planora-eventbus";
    private const string DeadLetterExchange = "planora-eventbus-dlx";
    private bool _disposed;

    public RabbitMqEventBus(
        IRabbitMqConnectionManager connectionManager,
        ILogger<RabbitMqEventBus> logger,
        IServiceProvider serviceProvider)
    {
        _connectionManager = connectionManager;
        _logger = logger;
        _serviceProvider = serviceProvider;
    }

    public async Task EnsureConnectionAsync(CancellationToken cancellationToken = default)
    {
        var connection = await _connectionManager.GetConnectionAsync(cancellationToken);
        var channel = await connection.CreateChannelAsync();

        try
        {
            await channel.ExchangeDeclareAsync(ExchangeName, RabbitMQ.Client.ExchangeType.Topic, durable: true, autoDelete: false, arguments: null);
            await channel.ExchangeDeclareAsync(DeadLetterExchange, RabbitMQ.Client.ExchangeType.Topic, durable: true, autoDelete: false, arguments: null);

            _logger.LogInformation("RabbitMQ EventBus connection ensured");
        }
        finally
        {
            await channel.DisposeAsync();
        }
    }

    public async Task PublishAsync<TEvent>(TEvent @event, CancellationToken cancellationToken = default)
        where TEvent : IntegrationEvent
    {
        var eventName = @event.GetType().Name;
        var connection = await _connectionManager.GetConnectionAsync(cancellationToken);
        var channel = await connection.CreateChannelAsync();

        try
        {
            await channel.ExchangeDeclareAsync(ExchangeName, RabbitMQ.Client.ExchangeType.Topic, durable: true, autoDelete: false, arguments: null);

            var message = JsonSerializer.Serialize(@event, @event.GetType());
            ReadOnlyMemory<byte> body = Encoding.UTF8.GetBytes(message);

            var properties = new RabbitMQ.Client.BasicProperties
            {
                DeliveryMode = RabbitMQ.Client.DeliveryModes.Persistent,
                ContentType = "application/json",
                MessageId = @event.Id.ToString(),
                Timestamp = new AmqpTimestamp(DateTimeOffset.UtcNow.ToUnixTimeSeconds()),
                Type = eventName
            };

            await channel.BasicPublishAsync(ExchangeName, eventName, false, properties, body, cancellationToken);

            _logger.LogInformation("Published event {EventName} with ID {EventId}", eventName, @event.Id);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error publishing event {EventName}", eventName);
            throw;
        }
        finally
        {
            await channel.DisposeAsync();
        }
    }

    public async Task SubscribeAsync<TEvent, THandler>(CancellationToken cancellationToken = default)
        where TEvent : IntegrationEvent
        where THandler : IIntegrationEventHandler<TEvent>
    {
        var eventName = typeof(TEvent).Name;
        var handlerType = typeof(THandler);

        if (!_eventHandlers.ContainsKey(eventName))
            _eventHandlers[eventName] = new List<Type>();

        if (_eventHandlers[eventName].Contains(handlerType))
        {
            _logger.LogWarning("Handler {HandlerType} already registered for event {EventName}",
                handlerType.Name, eventName);
            return;
        }

        _eventHandlers[eventName].Add(handlerType);

        var connection = await _connectionManager.GetConnectionAsync(cancellationToken);
        var channel = await connection.CreateChannelAsync();

        await channel.ExchangeDeclareAsync(ExchangeName, RabbitMQ.Client.ExchangeType.Topic, durable: true, autoDelete: false, arguments: null);

        var queueName = $"{eventName}.{handlerType.Name}";
        var arguments = new Dictionary<string, object?>
        {
            { "x-dead-letter-exchange", DeadLetterExchange }
        };

        await channel.QueueDeclareAsync(queueName, durable: true, exclusive: false, autoDelete: false, arguments: arguments);

        await channel.QueueBindAsync(queueName, ExchangeName, eventName, arguments: null);

        await channel.BasicQosAsync(0, 1, false);

        var consumer = new RabbitMQ.Client.Events.AsyncEventingBasicConsumer(channel);
        consumer.ReceivedAsync += async (_, ea) => await ProcessEventAsync(channel, eventName, ea);

        await channel.BasicConsumeAsync(queueName, autoAck: false, consumerTag: string.Empty, noLocal: false, exclusive: false, arguments: null, consumer: consumer, cancellationToken);

        _consumerChannels[queueName] = channel;

        _logger.LogInformation("Subscribed to event {EventName} with handler {HandlerName}",
            eventName, handlerType.Name);
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
                _eventHandlers.Remove(eventName);
        }

        var queueName = $"{eventName}.{handlerType.Name}";
        if (_consumerChannels.TryGetValue(queueName, out var channel))
        {
            if (channel != null)
                await channel.DisposeAsync();
            _consumerChannels.Remove(queueName);
        }

        _logger.LogInformation("Unsubscribed from event {EventName} handler {HandlerName}",
            eventName, handlerType.Name);
        await Task.CompletedTask;
    }

    private async Task ProcessEventAsync(IChannel channel, string eventName, BasicDeliverEventArgs eventArgs)
    {
        if (!_eventHandlers.ContainsKey(eventName))
        {
            _logger.LogWarning("No handlers found for event {EventName}", eventName);
            return;
        }

        try
        {
            var message = Encoding.UTF8.GetString(eventArgs.Body.ToArray());

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
                    var result = handleMethod?.Invoke(handler, new[] { @event, CancellationToken.None });
                    if (result is Task t)
                        await t;
                }
            }

            await channel.BasicAckAsync(eventArgs.DeliveryTag, false);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error processing event {EventName}", eventName);
            await channel.BasicNackAsync(eventArgs.DeliveryTag, false, true);
        }
    }

    public void Dispose()
    {
        if (_disposed)
            return;

        foreach (var channel in _consumerChannels.Values)
        {
            channel?.DisposeAsync().GetAwaiter().GetResult();
        }

        _consumerChannels.Clear();
        _disposed = true;
    }
}
