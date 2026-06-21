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

        // Use the Guid constructor so the inbox row's PRIMARY KEY is the event id. The previous
        // string constructor stored a random PK, so the ExistsAsync(eventId) check above could never
        // match and dedup did nothing. With PK == eventId, the check works AND a concurrent duplicate
        // delivery that slips past it fails the unique-key insert below — which we catch and treat as
        // "already being processed", so the decorated handler never runs twice (closes the
        // check-then-insert race).
        var inboxMessage = new InboxMessage(
            eventId,
            eventType,
            System.Text.Json.JsonSerializer.Serialize(@event),
            DateTime.UtcNow);

        try
        {
            await _inboxRepository.AddAsync(inboxMessage, cancellationToken);
        }
        catch (DbUpdateException)
        {
            _logger.LogInformation(
                "Event {EventType} with ID {EventId} is already being processed by a concurrent delivery; skipping",
                eventType, eventId);
            return;
        }

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

        // Fallback: generate deterministic GUID from event content. SHA256 truncated to
        // 16 bytes — MD5 is fast but cryptographically broken and trips static analyzers
        // (CA5351); SHA256 has the same determinism property without the audit-tooling
        // friction. The truncation is acceptable because the GUID is used only as an
        // idempotency key in the inbox table, not as a security primitive.
        var json = System.Text.Json.JsonSerializer.Serialize(@event);
        var fullHash = System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(json));
        return new Guid(fullHash.AsSpan(0, 16));
    }
}
