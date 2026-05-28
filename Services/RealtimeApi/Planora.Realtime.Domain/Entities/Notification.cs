namespace Planora.Realtime.Domain.Entities;

/// <summary>
/// Durable record of a notification consumed from the integration-event bus.
/// Persisting before fan-out lets a restarted realtime pod re-deliver to clients
/// that came back online, instead of losing notifications that were only in
/// process memory at crash time.
/// </summary>
public sealed class Notification : BaseEntity
{
    /// <summary>Recipient user.</summary>
    public Guid UserId { get; private set; }

    /// <summary>Short human-readable headline (e.g. "New shared todo").</summary>
    public string Title { get; private set; } = string.Empty;

    /// <summary>Body text shown in the UI.</summary>
    public string Message { get; private set; } = string.Empty;

    /// <summary>Discriminator the frontend uses to pick an icon / route (e.g. "todo.shared").</summary>
    public string Type { get; private set; } = string.Empty;

    /// <summary>UTC timestamp the originating event was raised (taken from <c>IntegrationEvent.OccurredOnUtc</c>).</summary>
    public DateTime OccurredOnUtc { get; private set; }

    /// <summary>Idempotency anchor from the integration event.</summary>
    public Guid SourceEventId { get; private set; }

    private Notification() { }

    public Notification(
        Guid userId,
        string title,
        string message,
        string type,
        DateTime occurredOnUtc,
        Guid sourceEventId)
    {
        if (userId == Guid.Empty) throw new ArgumentException("UserId cannot be empty", nameof(userId));
        if (string.IsNullOrWhiteSpace(message)) throw new ArgumentException("Message cannot be empty", nameof(message));
        if (string.IsNullOrWhiteSpace(type)) throw new ArgumentException("Type cannot be empty", nameof(type));

        UserId = userId;
        Title = title ?? string.Empty;
        Message = message;
        Type = type;
        OccurredOnUtc = occurredOnUtc == default ? DateTime.UtcNow : occurredOnUtc;
        SourceEventId = sourceEventId;
    }
}
