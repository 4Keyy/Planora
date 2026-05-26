namespace Planora.BuildingBlocks.Application.Outbox;

/// <summary>
/// A row in the per-service outbox table. Owns its own retry / dead-letter
/// state machine — the processor never sets <see cref="Status"/> directly,
/// it calls <see cref="MarkAsFailed"/> (transient) or
/// <see cref="MarkAsDeadLettered"/> (non-recoverable) and the entity decides
/// whether to schedule another attempt or transition to the terminal
/// <see cref="OutboxMessageStatus.DeadLettered"/> state.
/// </summary>
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

    /// <summary>
    /// Records a transient failure. Increments <see cref="RetryCount"/> and:
    /// <list type="bullet">
    /// <item><description>schedules another attempt via <see cref="NextRetryUtc"/>
    /// when retries remain, leaving the row picked up by the polling
    /// query;</description></item>
    /// <item><description>auto-transitions to the terminal
    /// <see cref="OutboxMessageStatus.DeadLettered"/> state when the retry
    /// budget is exhausted, clearing <see cref="NextRetryUtc"/> so the row
    /// can no longer satisfy the polling WHERE clause.</description></item>
    /// </list>
    /// The auto-transition fixes the historical bug where a message that
    /// hit <c>MaxRetries</c> would be left in <c>Failed</c> with a stale
    /// <c>NextRetryUtc</c> in the past, causing the processor to re-pick it
    /// on every cycle forever.
    /// </summary>
    public void MarkAsFailed(string error)
    {
        Error = error;
        RetryCount++;

        if (RetryCount < MaxRetries)
        {
            // Exponential backoff: 1 min, 5 min, 15 min  (Math.Pow(5, n-1)).
            var delayMinutes = Math.Pow(5, RetryCount - 1);
            NextRetryUtc = DateTime.UtcNow.AddMinutes(delayMinutes);
            Status = OutboxMessageStatus.Pending;
        }
        else
        {
            // Retry budget exhausted — move to the terminal dead-letter state
            // so the polling query in OutboxProcessor cannot re-pick this row.
            // The dead-letter timestamp is the row's existing ModifiedAt / audit
            // column (via BaseEntity) — no extra database column is required, so
            // this fix is schema-compatible with every already-deployed outbox table.
            Status = OutboxMessageStatus.DeadLettered;
            NextRetryUtc = null;
        }
    }

    /// <summary>
    /// Hard dead-letter for failures that are not worth retrying — type
    /// resolution failure, deserialization failure, or any other shape error
    /// that will fail identically on every replay. Skips the retry budget
    /// entirely and parks the row in the terminal
    /// <see cref="OutboxMessageStatus.DeadLettered"/> state.
    /// </summary>
    public void MarkAsDeadLettered(string reason)
    {
        Status = OutboxMessageStatus.DeadLettered;
        Error = reason;
        NextRetryUtc = null;
    }

    /// <summary>
    /// True only while the row is in a transient state with retries
    /// remaining. Returns false once the message has been dead-lettered,
    /// processed, or has exhausted its retry budget.
    /// </summary>
    public bool CanRetry => RetryCount < MaxRetries
        && Status != OutboxMessageStatus.DeadLettered
        && Status != OutboxMessageStatus.Processed;

    /// <summary>Convenience predicate for operators and metrics.</summary>
    public bool IsDeadLettered => Status == OutboxMessageStatus.DeadLettered;
}
