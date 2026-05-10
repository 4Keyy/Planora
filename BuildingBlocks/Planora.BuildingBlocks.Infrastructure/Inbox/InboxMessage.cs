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