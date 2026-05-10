namespace Planora.BuildingBlocks.Infrastructure.Outbox;

public sealed class OutboxMessage : BaseEntity
{
    public string Type { get; private set; } = string.Empty;
    public string Content { get; private set; } = string.Empty;
    public DateTime OccurredOnUtc { get; private set; }
    public DateTime? ProcessedOnUtc { get; private set; }
    public OutboxMessageStatus Status { get; private set; }
    public string? Error { get; private set; }
    public int RetryCount { get; private set; }
    public DateTime? NextRetryUtc { get; private set; }
    private const int MaxRetries = 3;

    private OutboxMessage() : base() { }

    public OutboxMessage(string type, string content, DateTime occurredOnUtc) : base()
    {
        Type = type;
        Content = content;
        OccurredOnUtc = occurredOnUtc;
        Status = OutboxMessageStatus.Pending;
        RetryCount = 0;
    }

    public void MarkAsProcessing()
    {
        Status = OutboxMessageStatus.Processing;
    }

    public void MarkAsProcessed()
    {
        ProcessedOnUtc = DateTime.UtcNow;
        Status = OutboxMessageStatus.Processed;
        Error = null;
    }

    public void MarkAsFailed(string error)
    {
        Error = error;
        Status = OutboxMessageStatus.Failed;
        RetryCount++;

        if (RetryCount < MaxRetries)
        {
            // Exponential backoff: 1 min, 5 min, 15 min
            var delayMinutes = Math.Pow(5, RetryCount - 1);
            NextRetryUtc = DateTime.UtcNow.AddMinutes(delayMinutes);
            Status = OutboxMessageStatus.Pending;
        }
    }

    public bool CanRetry => RetryCount < MaxRetries;
}
