namespace Planora.BuildingBlocks.Application.Outbox;

/// <summary>
/// Lifecycle states for an outbox row. The terminal states
/// (<see cref="Processed"/> and <see cref="DeadLettered"/>) are never picked up
/// again by <c>OutboxProcessor</c>'s polling query — they exist only as
/// audit trail.
/// </summary>
public enum OutboxMessageStatus
{
    /// <summary>Ready to be picked up by the processor.</summary>
    Pending = 0,

    /// <summary>Currently being processed by the active worker.</summary>
    Processing = 1,

    /// <summary>Terminal — successfully published to the broker.</summary>
    Processed = 2,

    /// <summary>
    /// Transient failure with retries remaining. <c>NextRetryUtc</c> is set
    /// to a future point at which the polling query will pick the row up
    /// again, applying the configured exponential back-off.
    /// </summary>
    Failed = 3,

    /// <summary>
    /// Terminal — retry budget exhausted, message will NEVER be retried by
    /// the standard processor. Requires operator intervention (manual replay
    /// after fixing the underlying cause, or explicit purge). Surfaced by
    /// the <c>planora.outbox.messages{outcome="retry_exhausted"}</c> counter
    /// (and by <c>type_not_found</c> / <c>deserialize_failed</c> for
    /// non-recoverable shapes that skip retry entirely).
    /// </summary>
    DeadLettered = 4,
}
