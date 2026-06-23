namespace Planora.BuildingBlocks.Infrastructure.Inbox;

public sealed class InboxMessage : BaseEntity
{
    public string MessageId { get; private set; } = string.Empty;
    public string Type { get; private set; } = string.Empty;
    public string Content { get; private set; } = string.Empty;
    public DateTime ReceivedOn { get; private set; }
    public DateTime? ProcessedOn { get; private set; }
    public InboxMessageStatus Status { get; private set; }
    public string? Error { get; private set; }

    private InboxMessage() : base() { }

    public InboxMessage(string messageId, string type, string content, DateTime receivedOn)
        : base()
    {
        MessageId = messageId;
        Type = type;
        Content = content;
        ReceivedOn = receivedOn;
        Status = InboxMessageStatus.Pending;
    }

    /// <summary>
    /// Creates an inbox record whose primary key IS the integration event's Id, so a duplicate
    /// delivery of the same event is detected by a simple PK existence check
    /// (<see cref="IInboxRepository.ExistsAsync"/>). Used by the event bus for consumer
    /// idempotency (dedup keyed on the stable, broker-propagated event id).
    /// </summary>
    public InboxMessage(Guid eventId, string type, string content, DateTime receivedOn)
        : base(eventId)
    {
        MessageId = eventId.ToString();
        Type = type;
        Content = content;
        ReceivedOn = receivedOn;
        Status = InboxMessageStatus.Pending;
    }

    /// <summary>
    /// Creates an inbox record whose primary key is a caller-supplied idempotency key that may differ
    /// from the raw event id — used to dedup per (event id, handler) so an event fanned out to several
    /// handlers is processed once per handler rather than once overall. <paramref name="messageId"/>
    /// keeps the human-readable real event id for diagnostics.
    /// </summary>
    public InboxMessage(Guid primaryKey, string messageId, string type, string content, DateTime receivedOn)
        : base(primaryKey)
    {
        MessageId = messageId;
        Type = type;
        Content = content;
        ReceivedOn = receivedOn;
        Status = InboxMessageStatus.Pending;
    }

    public void MarkAsProcessing()
    {
        Status = InboxMessageStatus.Processing;
    }

    public void MarkAsProcessed()
    {
        ProcessedOn = DateTime.UtcNow;
        Status = InboxMessageStatus.Processed;
    }

    public void MarkAsFailed(string error)
    {
        Error = error;
        Status = InboxMessageStatus.Failed;
    }
}