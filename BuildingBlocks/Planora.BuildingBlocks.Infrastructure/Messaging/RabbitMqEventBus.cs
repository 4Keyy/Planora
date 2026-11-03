using System.Text.RegularExpressions;
using RabbitMQ.Client;
using RabbitMQ.Client.Events;

namespace Planora.BuildingBlocks.Infrastructure.Messaging;

public sealed class RabbitMqEventBus : IEventBus, IDisposable, IAsyncDisposable
{
    private readonly IRabbitMqConnectionManager _connectionManager;
    private readonly ILogger<RabbitMqEventBus> _logger;
    private readonly IServiceProvider _serviceProvider;

    private sealed record Subscription(Type EventType, Type HandlerType, IChannel Channel);

    private readonly Dictionary<string, Subscription> _subscriptions = new(StringComparer.Ordinal);
    private readonly SemaphoreSlim _subscriptionLock = new(1, 1);

    // A single reused confirm-channel for publishing. Creating a channel + declaring the
    // exchange on every publish cost ~3 AMQP round-trips per message; the outbox drains in
    // batches, so that overhead dominated. The channel is rebuilt on demand if it faults.
    private RabbitMQ.Client.IChannel? _publishChannel;
    private readonly SemaphoreSlim _publishLock = new(1, 1);

    private const string ExchangeName = "planora-eventbus";
    private const string DeadLetterExchange = "planora-eventbus-dlx";
    private int _disposeState;
    private bool IsDisposed => Volatile.Read(ref _disposeState) != 0;

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
        ObjectDisposedException.ThrowIf(IsDisposed, this);
        var connection = await _connectionManager.GetConnectionAsync(cancellationToken);
        var channel = await connection.CreateChannelAsync(cancellationToken: cancellationToken);

        try
        {
            await channel.ExchangeDeclareAsync(ExchangeName, RabbitMQ.Client.ExchangeType.Topic, durable: true, autoDelete: false, arguments: null, cancellationToken: cancellationToken);
            await channel.ExchangeDeclareAsync(DeadLetterExchange, RabbitMQ.Client.ExchangeType.Topic, durable: true, autoDelete: false, arguments: null, cancellationToken: cancellationToken);

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
        ObjectDisposedException.ThrowIf(IsDisposed, this);
        var eventName = @event.GetType().Name;

        // A channel is not safe for concurrent publishes (especially with confirm tracking,
        // where BasicPublishAsync awaits the per-message broker ack). Serialise on the lock so
        // the reused channel handles one publish at a time; the outbox publishes sequentially
        // anyway, so this is not a throughput regression.
        await _publishLock.WaitAsync(cancellationToken);
        try
        {
            ObjectDisposedException.ThrowIf(IsDisposed, this);
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

        try
        {
            await channel.ExchangeDeclareAsync(ExchangeName, RabbitMQ.Client.ExchangeType.Topic, durable: true, autoDelete: false,
                arguments: null, cancellationToken: cancellationToken);
            _publishChannel = channel;
            return channel;
        }
        catch
        {
            await channel.DisposeAsync();
            throw;
        }
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

    public async Task SubscribeAsync<TEvent, THandler>(string subscriptionId, CancellationToken cancellationToken = default)
        where TEvent : IntegrationEvent
        where THandler : IIntegrationEventHandler<TEvent>
    {
        ValidateSubscriptionId(subscriptionId);
        ObjectDisposedException.ThrowIf(IsDisposed, this);
        await _subscriptionLock.WaitAsync(cancellationToken);
        try
        {
            ObjectDisposedException.ThrowIf(IsDisposed, this);
            if (_subscriptions.TryGetValue(subscriptionId, out var existing))
            {
                EnsureSubscriptionTypes<TEvent, THandler>(subscriptionId, existing);
                if (existing.Channel.IsOpen)
                    return;
                _subscriptions.Remove(subscriptionId);
                await existing.Channel.DisposeAsync();
            }

            var connection = await _connectionManager.GetConnectionAsync(cancellationToken);
            var channel = await connection.CreateChannelAsync(cancellationToken: cancellationToken);
            var registered = false;
            try
            {
                await channel.ExchangeDeclareAsync(ExchangeName, ExchangeType.Topic, durable: true, autoDelete: false,
                    arguments: null, cancellationToken: cancellationToken);
                await channel.ExchangeDeclareAsync(DeadLetterExchange, ExchangeType.Topic, durable: true, autoDelete: false,
                    arguments: null, cancellationToken: cancellationToken);

                var queueName = $"planora.{subscriptionId}.v1";
                var deadLetterQueue = queueName + ".dlq";
                await channel.QueueDeclareAsync(deadLetterQueue, durable: true, exclusive: false, autoDelete: false,
                    arguments: new Dictionary<string, object?> { ["x-queue-type"] = "quorum" }, cancellationToken: cancellationToken);
                await channel.QueueBindAsync(deadLetterQueue, DeadLetterExchange, queueName,
                    arguments: null, cancellationToken: cancellationToken);

                // Quorum's confirmed dead-letter transfer retains rejected deliveries while the DLQ is unavailable.
                var arguments = new Dictionary<string, object?>
                {
                    ["x-queue-type"] = "quorum",
                    ["x-dead-letter-exchange"] = DeadLetterExchange,
                    ["x-dead-letter-routing-key"] = queueName,
                    ["x-dead-letter-strategy"] = "at-least-once",
                    ["x-overflow"] = "reject-publish"
                };
                await channel.QueueDeclareAsync(queueName, durable: true, exclusive: false, autoDelete: false,
                    arguments: arguments, cancellationToken: cancellationToken);
                var eventName = typeof(TEvent).Name;
                await channel.QueueBindAsync(queueName, ExchangeName, eventName,
                    arguments: null, cancellationToken: cancellationToken);
                await channel.BasicQosAsync(0, 1, global: false, cancellationToken: cancellationToken);

                var consumer = new AsyncEventingBasicConsumer(channel);
                consumer.ReceivedAsync += (_, delivery) => ProcessEventAsync<TEvent, THandler>(channel, subscriptionId, delivery);
                await channel.BasicConsumeAsync(queueName, autoAck: false, consumerTag: string.Empty, noLocal: false,
                    exclusive: false, arguments: null, consumer: consumer, cancellationToken: cancellationToken);
                cancellationToken.ThrowIfCancellationRequested();
                ObjectDisposedException.ThrowIf(IsDisposed, this);
                _subscriptions.Add(subscriptionId, new(typeof(TEvent), typeof(THandler), channel));
                registered = true;
                _logger.LogInformation("Subscribed {SubscriptionId} to event {EventName} with handler {HandlerName}",
                    subscriptionId, eventName, typeof(THandler).Name);
            }
            finally
            {
                if (!registered)
                    await channel.DisposeAsync();
            }
        }
        finally
        {
            _subscriptionLock.Release();
        }
    }

    public async Task UnsubscribeAsync<TEvent, THandler>(string subscriptionId, CancellationToken cancellationToken = default)
        where TEvent : IntegrationEvent
        where THandler : IIntegrationEventHandler<TEvent>
    {
        ValidateSubscriptionId(subscriptionId);
        ObjectDisposedException.ThrowIf(IsDisposed, this);
        await _subscriptionLock.WaitAsync(cancellationToken);
        try
        {
            ObjectDisposedException.ThrowIf(IsDisposed, this);
            if (!_subscriptions.TryGetValue(subscriptionId, out var subscription))
                return;
            EnsureSubscriptionTypes<TEvent, THandler>(subscriptionId, subscription);
            _subscriptions.Remove(subscriptionId);
            await subscription.Channel.DisposeAsync();
            _logger.LogInformation("Unsubscribed {SubscriptionId} from event {EventName}", subscriptionId, typeof(TEvent).Name);
        }
        finally
        {
            _subscriptionLock.Release();
        }
    }

    private static void ValidateSubscriptionId(string subscriptionId)
    {
        if (string.IsNullOrEmpty(subscriptionId) || subscriptionId.Length > 120 ||
            !Regex.IsMatch(subscriptionId, @"\A[a-z0-9]+(?:[.-][a-z0-9]+)*\z", RegexOptions.CultureInvariant))
            throw new ArgumentException("Subscription ID must contain lowercase letters or digits separated by single dots or hyphens (maximum 120 characters).", nameof(subscriptionId));
    }

    private static void EnsureSubscriptionTypes<TEvent, THandler>(string subscriptionId, Subscription subscription)
    {
        if (subscription.EventType != typeof(TEvent) || subscription.HandlerType != typeof(THandler))
            throw new InvalidOperationException($"Subscription '{subscriptionId}' is already assigned to another event or handler.");
    }

    private async Task ProcessEventAsync<TEvent, THandler>(IChannel channel, string subscriptionId, BasicDeliverEventArgs eventArgs)
        where TEvent : IntegrationEvent
        where THandler : IIntegrationEventHandler<TEvent>
    {
        var eventName = typeof(TEvent).Name;
        try
        {
            var message = Encoding.UTF8.GetString(eventArgs.Body.Span);
            var @event = JsonSerializer.Deserialize<TEvent>(message)
                ?? throw new JsonException("The integration event payload must not be null.");
            using var scope = _serviceProvider.CreateScope();
            var handler = scope.ServiceProvider.GetRequiredService<THandler>();

            // Preserve existing per-handler keys so deliveries already recorded before this topology change still deduplicate.
            var inbox = scope.ServiceProvider.GetService<IInboxRepository>();
            var eventId = @event.Id;
            var inboxKey = eventId == Guid.Empty ? Guid.Empty : DeriveInboxKey(eventId, typeof(THandler));
            if (inbox != null && inboxKey != Guid.Empty)
            {
                var alreadyProcessed = false;
                try
                {
                    alreadyProcessed = await inbox.ExistsAsync(inboxKey, CancellationToken.None);
                }
                catch (Exception dedupEx)
                {
                    _logger.LogWarning(dedupEx, "Inbox dedup check failed for {EventName}; processing without dedup", eventName);
                    inbox = null;
                }
                if (alreadyProcessed)
                {
                    _logger.LogInformation("Skipping already-processed event {EventName} {EventId} for {SubscriptionId}",
                        eventName, eventId, subscriptionId);
                    await channel.BasicAckAsync(eventArgs.DeliveryTag, multiple: false);
                    return;
                }
            }

            await handler.HandleAsync(@event, CancellationToken.None);
            if (inbox != null && inboxKey != Guid.Empty)
            {
                try
                {
                    var record = new InboxMessage(inboxKey, eventId.ToString(), eventName, message, DateTime.UtcNow);
                    record.MarkAsProcessed();
                    await inbox.AddAsync(record, CancellationToken.None);
                }
                catch (Exception recordEx)
                {
                    _logger.LogWarning(recordEx, "Failed to record processed event {EventName} {EventId} in inbox", eventName, eventId);
                }
            }

            await channel.BasicAckAsync(eventArgs.DeliveryTag, multiple: false);
        }
        catch (Exception ex)
        {
            var requeue = ClassifyFailure(ex, eventArgs.Redelivered) == DeliveryFailureAction.Requeue;
            _logger.LogError(ex, "Event {EventName} for {SubscriptionId} failed; requeue={Requeue}", eventName, subscriptionId, requeue);
            await channel.BasicNackAsync(eventArgs.DeliveryTag, multiple: false, requeue: requeue);
        }
    }

    /// <summary>
    /// Derives the per-handler inbox idempotency key from the event id and the handler type, so the
    /// same event delivered to N handlers dedups independently (once per handler). Deterministic:
    /// SHA-256 of "<c>{eventId:N}:{handler full name}</c>" truncated to a GUID. SHA-256 (not MD5) is
    /// used only to avoid the CA5351 analyzer — the value is an idempotency key, not a security token.
    /// </summary>
    internal static Guid DeriveInboxKey(Guid eventId, Type handlerType)
    {
        var seed = $"{eventId:N}:{handlerType.FullName ?? handlerType.Name}";
        var hash = System.Security.Cryptography.SHA256.HashData(Encoding.UTF8.GetBytes(seed));
        return new Guid(hash.AsSpan(0, 16));
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
        if (Interlocked.Exchange(ref _disposeState, 1) != 0)
            return;

        await _subscriptionLock.WaitAsync();
        try
        {
            foreach (var subscription in _subscriptions.Values)
            {
                try { await subscription.Channel.DisposeAsync(); }
                catch (Exception ex) { _logger.LogWarning(ex, "Error disposing subscription channel"); }
            }
            _subscriptions.Clear();
        }
        finally
        {
            _subscriptionLock.Release();
        }

        await _publishLock.WaitAsync();
        try { await DisposePublishChannelAsync(); }
        finally { _publishLock.Release(); }
    }

    public void Dispose()
    {
        if (Interlocked.Exchange(ref _disposeState, 1) != 0)
            return;

        _subscriptionLock.Wait();
        try
        {
            foreach (var subscription in _subscriptions.Values)
            {
                try { subscription.Channel.Dispose(); }
                catch (Exception ex) { _logger.LogWarning(ex, "Error disposing subscription channel"); }
            }
            _subscriptions.Clear();
        }
        finally
        {
            _subscriptionLock.Release();
        }

        _publishLock.Wait();
        try
        {
            _publishChannel?.Dispose();
            _publishChannel = null;
        }
        finally
        {
            _publishLock.Release();
        }
        // The managed semaphores remain usable for in-flight waiters, which observe IsDisposed after acquiring them.
    }
}
