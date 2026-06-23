using System.Collections.Concurrent;
using RabbitMQ.Client;
using RabbitMQ.Client.Events;

namespace Planora.BuildingBlocks.Infrastructure.Messaging;

public sealed class RabbitMqEventBus : IEventBus, IDisposable, IAsyncDisposable
{
    private readonly IRabbitMqConnectionManager _connectionManager;
    private readonly ILogger<RabbitMqEventBus> _logger;
    private readonly IServiceProvider _serviceProvider;

    // Singleton bus shared across the whole process: Subscribe (startup) and the async
    // consumer callbacks race on these maps, so they must be concurrency-safe. The handler
    // lists are treated as copy-on-write (replaced, never mutated in place) so a consumer
    // enumerating a snapshot is never torn by a concurrent Subscribe/Unsubscribe.
    private readonly ConcurrentDictionary<string, IReadOnlyList<Type>> _eventHandlers = new();
    private readonly ConcurrentDictionary<string, RabbitMQ.Client.IChannel> _consumerChannels = new();

    // A single reused confirm-channel for publishing. Creating a channel + declaring the
    // exchange on every publish cost ~3 AMQP round-trips per message; the outbox drains in
    // batches, so that overhead dominated. The channel is rebuilt on demand if it faults.
    private RabbitMQ.Client.IChannel? _publishChannel;
    private readonly SemaphoreSlim _publishLock = new(1, 1);

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
        var channel = await connection.CreateChannelAsync(cancellationToken: cancellationToken);

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

        // A channel is not safe for concurrent publishes (especially with confirm tracking,
        // where BasicPublishAsync awaits the per-message broker ack). Serialise on the lock so
        // the reused channel handles one publish at a time; the outbox publishes sequentially
        // anyway, so this is not a throughput regression.
        await _publishLock.WaitAsync(cancellationToken);
        try
        {
            var channel = await GetOrCreatePublishChannelAsync(cancellationToken);

            try
            {
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

                // SECURITY / RELIABILITY (T4.7): publisher confirms + mandatory flag.
                //   The channel is created with publisherConfirmationsEnabled +
                //   publisherConfirmationTrackingEnabled, so BasicPublishAsync awaits the broker
                //   ack and throws on nack; mandatory:true surfaces an unroutable message as a
                //   failure instead of letting it vanish. The Outbox depends on this: a returned
                //   task == broker durability commitment, so the outbox row is only marked
                //   Processed on success and retried on throw (INV-COMM-3a).
                await channel.BasicPublishAsync(
                    exchange: ExchangeName,
                    routingKey: eventName,
                    mandatory: true,
                    basicProperties: properties,
                    body: body,
                    cancellationToken: cancellationToken);

                _logger.LogInformation("Published event {EventName} with ID {EventId} (broker confirmed)", eventName, @event.Id);
            }
            catch (Exception ex)
            {
                // The channel may be in a faulted state after a publish error — drop it so the
                // next publish rebuilds a fresh confirm-channel rather than reusing a broken one.
                _logger.LogError(ex, "Error publishing event {EventName}", eventName);
                await DisposePublishChannelAsync();
                throw;
            }
        }
        finally
        {
            _publishLock.Release();
        }
    }

    // Must be called under _publishLock.
    private async Task<RabbitMQ.Client.IChannel> GetOrCreatePublishChannelAsync(CancellationToken cancellationToken)
    {
        if (_publishChannel is { IsOpen: true })
            return _publishChannel;

        await DisposePublishChannelAsync();

        var connection = await _connectionManager.GetConnectionAsync(cancellationToken);
        var channelOpts = new CreateChannelOptions(
            publisherConfirmationsEnabled: true,
            publisherConfirmationTrackingEnabled: true);
        var channel = await connection.CreateChannelAsync(channelOpts, cancellationToken);

        await channel.ExchangeDeclareAsync(ExchangeName, RabbitMQ.Client.ExchangeType.Topic, durable: true, autoDelete: false, arguments: null);

        _publishChannel = channel;
        return channel;
    }

    // Must be called under _publishLock.
    private async Task DisposePublishChannelAsync()
    {
        if (_publishChannel is null)
            return;

        try
        {
            await _publishChannel.DisposeAsync();
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Error disposing publish channel");
        }
        finally
        {
            _publishChannel = null;
        }
    }

    public async Task SubscribeAsync<TEvent, THandler>(CancellationToken cancellationToken = default)
        where TEvent : IntegrationEvent
        where THandler : IIntegrationEventHandler<TEvent>
    {
        var eventName = typeof(TEvent).Name;
        var handlerType = typeof(THandler);

        var alreadyRegistered = false;
        _eventHandlers.AddOrUpdate(
            eventName,
            _ => new[] { handlerType },
            (_, existing) =>
            {
                if (existing.Contains(handlerType))
                {
                    alreadyRegistered = true;
                    return existing;
                }
                // Copy-on-write: never mutate the list a consumer might be enumerating.
                return existing.Append(handlerType).ToArray();
            });

        if (alreadyRegistered)
        {
            _logger.LogWarning("Handler {HandlerType} already registered for event {EventName}",
                handlerType.Name, eventName);
            return;
        }

        var connection = await _connectionManager.GetConnectionAsync(cancellationToken);
        var channel = await connection.CreateChannelAsync(cancellationToken: cancellationToken);

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

        _eventHandlers.AddOrUpdate(
            eventName,
            _ => Array.Empty<Type>(),
            (_, existing) => existing.Where(t => t != handlerType).ToArray());

        var queueName = $"{eventName}.{handlerType.Name}";
        if (_consumerChannels.TryRemove(queueName, out var channel) && channel != null)
        {
            await channel.DisposeAsync();
        }

        _logger.LogInformation("Unsubscribed from event {EventName} handler {HandlerName}",
            eventName, handlerType.Name);
    }

    private async Task ProcessEventAsync(IChannel channel, string eventName, BasicDeliverEventArgs eventArgs)
    {
        if (!_eventHandlers.TryGetValue(eventName, out var handlers) || handlers.Count == 0)
        {
            _logger.LogWarning("No handlers found for event {EventName}", eventName);
            // Nothing can ever process this message — dead-letter it instead of requeueing forever.
            await channel.BasicNackAsync(eventArgs.DeliveryTag, multiple: false, requeue: false);
            return;
        }

        try
        {
            var message = Encoding.UTF8.GetString(eventArgs.Body.ToArray());

            foreach (var handlerType in handlers)
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

                if (@event == null)
                    continue;

                // Consumer idempotency (INV-COMM-4). Delivery is at-least-once, so a redelivered
                // or restart-replayed event must not run the handler twice. We dedup on the stable
                // event Id via the service's inbox. This is graceful and defensive: if the service
                // registers no IInboxRepository (or it errors), we process without dedup — exactly
                // the previous behaviour, never worse.
                var inbox = scope.ServiceProvider.GetService<IInboxRepository>();
                var eventId = (@event as IntegrationEvent)?.Id ?? Guid.Empty;

                if (inbox != null && eventId != Guid.Empty)
                {
                    try
                    {
                        if (await inbox.ExistsAsync(eventId, CancellationToken.None))
                        {
                            _logger.LogInformation(
                                "Skipping already-processed event {EventName} {EventId} for handler {Handler}",
                                eventName, eventId, handlerType.Name);
                            continue;
                        }
                    }
                    catch (Exception dedupEx)
                    {
                        _logger.LogWarning(dedupEx,
                            "Inbox dedup check failed for {EventName}; processing without dedup", eventName);
                        inbox = null;
                    }
                }

                var handleMethod = handlerType.GetMethod("HandleAsync");
                var result = handleMethod?.Invoke(handler, new[] { @event, CancellationToken.None });
                if (result is Task t)
                    await t;

                if (inbox != null && eventId != Guid.Empty)
                {
                    try
                    {
                        var record = new InboxMessage(eventId, eventName, message, DateTime.UtcNow);
                        record.MarkAsProcessed();
                        await inbox.AddAsync(record, CancellationToken.None);
                    }
                    catch (Exception recordEx)
                    {
                        // Recording is best-effort: a failure here only risks reprocessing on a
                        // later redelivery, never data loss or a broken consume loop.
                        _logger.LogWarning(recordEx,
                            "Failed to record processed event {EventName} {EventId} in inbox", eventName, eventId);
                    }
                }
            }

            await channel.BasicAckAsync(eventArgs.DeliveryTag, false);
        }
        catch (Exception ex)
        {
            var action = ClassifyFailure(ex, eventArgs.Redelivered);
            if (action == DeliveryFailureAction.Requeue)
            {
                _logger.LogWarning(ex,
                    "Transient failure processing event {EventName}; requeueing once", eventName);
                await channel.BasicNackAsync(eventArgs.DeliveryTag, multiple: false, requeue: true);
            }
            else
            {
                _logger.LogError(ex,
                    "Dead-lettering event {EventName} (poison or retry-exhausted); routing to DLX", eventName);
                await channel.BasicNackAsync(eventArgs.DeliveryTag, multiple: false, requeue: false);
            }
        }
    }

    internal enum DeliveryFailureAction
    {
        Requeue,
        DeadLetter
    }

    /// <summary>
    /// Decides what to do with a delivery that failed to process. A payload that can never be
    /// deserialised (<see cref="JsonException"/>) is poison and is dead-lettered immediately —
    /// requeueing it would spin at 100% CPU forever. Any other (transient) failure is requeued
    /// exactly once; on the redelivery it is dead-lettered. This bounds retries instead of the
    /// old unconditional <c>requeue:true</c> that turned a permanent handler error into an
    /// infinite hot loop blocking the queue behind <c>prefetch=1</c>.
    /// </summary>
    internal static DeliveryFailureAction ClassifyFailure(Exception exception, bool redelivered) =>
        exception is JsonException || redelivered
            ? DeliveryFailureAction.DeadLetter
            : DeliveryFailureAction.Requeue;

    public async ValueTask DisposeAsync()
    {
        if (_disposed)
            return;
        _disposed = true;

        foreach (var channel in _consumerChannels.Values)
        {
            if (channel is not null)
                await channel.DisposeAsync();
        }
        _consumerChannels.Clear();

        if (_publishChannel is not null)
        {
            await _publishChannel.DisposeAsync();
            _publishChannel = null;
        }

        _publishLock.Dispose();
    }

    // Synchronous fallback for a synchronously-disposed DI container (e.g. unit tests). RabbitMQ.Client
    // channels are async-dispose-only, so the sync path only releases managed primitives; graceful
    // channel teardown happens via DisposeAsync on the async shutdown path the hosts actually use.
    public void Dispose()
    {
        if (_disposed)
            return;
        _disposed = true;

        _consumerChannels.Clear();
        _publishLock.Dispose();
    }
}
