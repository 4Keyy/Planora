using Planora.Realtime.Application.Interfaces;
using Planora.Realtime.Application.Response;
using Planora.Realtime.Domain.Entities;

namespace Planora.Realtime.Application.Handlers;

/// <summary>
/// Consumes a <see cref="NotificationEvent"/> from the bus, persists it to the durable notification
/// log (idempotent on the event id), and pushes the full persisted shape over SignalR. Persisting
/// before fan-out means an offline recipient still has the notification waiting when they reconnect,
/// and it backs the read-model the UI queries for unread counts. A duplicate redelivery is stored
/// at most once and pushed at most once.
/// </summary>
public sealed class NotificationEventHandler : IIntegrationEventHandler<NotificationEvent>
{
    private readonly ILogger<NotificationEventHandler> _logger;
    private readonly INotificationStore _store;
    private readonly INotificationService _notificationService;

    public NotificationEventHandler(
        ILogger<NotificationEventHandler> logger,
        INotificationStore store,
        INotificationService notificationService)
    {
        _logger = logger;
        _store = store;
        _notificationService = notificationService;
    }

    public async Task HandleAsync(NotificationEvent @event, CancellationToken cancellationToken = default)
    {
        // Defensive: a malformed event must not poison the queue. Drop (ack) instead of throwing.
        if (@event.UserId == Guid.Empty ||
            string.IsNullOrWhiteSpace(@event.Message) ||
            string.IsNullOrWhiteSpace(@event.Type))
        {
            _logger.LogWarning(
                "Discarding malformed NotificationEvent {EventId} (UserId/Message/Type missing)",
                @event.Id);
            return;
        }

        _logger.LogInformation(
            "📬 Handling NotificationEvent {EventId} for UserId={UserId}, Type={Type}",
            @event.Id, @event.UserId, @event.Type);

        var notification = new Notification(
            @event.UserId,
            @event.Title,
            @event.Message,
            @event.Type,
            @event.OccurredOn,
            @event.Id,
            @event.TaskId,
            @event.ActorId);

        // Idempotent persist: a redelivery of the same event is stored — and therefore pushed —
        // at most once, so a reconnecting client never sees the same toast twice.
        var isNew = await _store.TryAddAsync(notification, cancellationToken);
        if (!isNew)
        {
            _logger.LogDebug("NotificationEvent {EventId} already handled — skipping push", @event.Id);
            return;
        }

        await _notificationService.SendToUserAsync(NotificationPayload.From(notification), cancellationToken);
        _logger.LogInformation("✅ Notification {NotificationId} delivered to user {UserId}", notification.Id, @event.UserId);
    }
}
