namespace Planora.BuildingBlocks.Infrastructure.IdempotentConsumer;

public sealed class IdempotentMessageHandler<TEvent> : IIntegrationEventHandler<TEvent>
    where TEvent : IntegrationEvent
{
    private readonly IInboxRepository _inboxRepository;
    private readonly IIntegrationEventHandler<TEvent> _decorated;
    private readonly ILogger<IdempotentMessageHandler<TEvent>> _logger;

    public IdempotentMessageHandler(
        IInboxRepository inboxRepository,
        IIntegrationEventHandler<TEvent> decorated,
        ILogger<IdempotentMessageHandler<TEvent>> _logger)
    {
        _inboxRepository = inboxRepository;
        _decorated = decorated;
        this._logger = _logger;
    }

    public async Task HandleAsync(TEvent @event, CancellationToken cancellationToken = default)
    {
        var eventType = typeof(TEvent).Name; // ИСПРАВЛЕНО
        var eventId = GetEventId(@event);

        if (await _inboxRepository.ExistsAsync(eventId, cancellationToken))
        {
            _logger.LogInformation("Event {EventType} with ID {EventId} already processed", eventType, eventId);
            return;
        }

        var inboxMessage = new InboxMessage(
            eventId.ToString(),
            eventType,
            System.Text.Json.JsonSerializer.Serialize(@event),
            DateTime.UtcNow);

        await _inboxRepository.AddAsync(inboxMessage, cancellationToken);

        try
        {
            await _decorated.HandleAsync(@event, cancellationToken);

            inboxMessage.MarkAsProcessed();
            await _inboxRepository.UpdateAsync(inboxMessage, cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error processing event {EventType}", eventType);

            inboxMessage.MarkAsFailed(ex.Message);
            await _inboxRepository.UpdateAsync(inboxMessage, cancellationToken);

            throw;
        }
    }

    private static Guid GetEventId(TEvent @event)
    {
        var idProperty = typeof(TEvent).GetProperty("Id") ?? typeof(TEvent).GetProperty("EventId");

        if (idProperty != null)
        {
            var value = idProperty.GetValue(@event);
            if (value is Guid guidValue)
                return guidValue;
        }

        // Fallback: generate deterministic GUID from event content
        var json = System.Text.Json.JsonSerializer.Serialize(@event);
        using var md5 = System.Security.Cryptography.MD5.Create();
        var hash = md5.ComputeHash(System.Text.Encoding.UTF8.GetBytes(json));
        return new Guid(hash);
    }
}
