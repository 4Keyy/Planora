using Planora.BuildingBlocks.Application.Outbox;

namespace Planora.UnitTests.Services.Infrastructure;

/// <summary>
/// Pins down the OutboxMessage state machine, in particular the
/// retry-exhaustion -> dead-letter auto-transition. The historical bug it
/// guards against: after MaxRetries failures, the row was left in
/// <see cref="OutboxMessageStatus.Failed"/> with a stale
/// <see cref="OutboxMessage.NextRetryUtc"/> in the past, so the polling
/// query in OutboxProcessor re-picked the row on every cycle forever,
/// emitting a "retry_exhausted" metric each pass and consuming a slot
/// in the per-batch limit.
/// </summary>
public sealed class OutboxMessageStateMachineTests
{
    private const int MaxRetries = 3;

    [Fact]
    [Trait("TestType", "Outbox")]
    [Trait("TestType", "Regression")]
    public void NewMessage_IsPending()
    {
        var msg = NewMessage();
        Assert.Equal(OutboxMessageStatus.Pending, msg.Status);
        Assert.Equal(0, msg.RetryCount);
        Assert.Null(msg.NextRetryUtc);
        Assert.False(msg.IsDeadLettered);
        Assert.True(msg.CanRetry);
    }

    [Fact]
    [Trait("TestType", "Outbox")]
    [Trait("TestType", "Regression")]
    public void MarkAsProcessed_IsTerminal()
    {
        var msg = NewMessage();
        msg.MarkAsProcessing();
        msg.MarkAsProcessed();

        Assert.Equal(OutboxMessageStatus.Processed, msg.Status);
        Assert.NotNull(msg.ProcessedOnUtc);
        Assert.Null(msg.Error);
        Assert.False(msg.CanRetry);
        Assert.False(msg.IsDeadLettered);
    }

    [Fact]
    [Trait("TestType", "Outbox")]
    [Trait("TestType", "Regression")]
    public void FirstFailure_SchedulesRetry_WithExponentialBackoff()
    {
        var msg = NewMessage();
        var before = DateTime.UtcNow;
        msg.MarkAsFailed("transient downstream timeout");
        var after = DateTime.UtcNow;

        Assert.Equal(OutboxMessageStatus.Pending, msg.Status);
        Assert.Equal(1, msg.RetryCount);
        Assert.Equal("transient downstream timeout", msg.Error);
        Assert.NotNull(msg.NextRetryUtc);
        // First retry uses Math.Pow(5, 0) == 1 minute.
        Assert.InRange(
            msg.NextRetryUtc!.Value,
            before.AddMinutes(1).AddSeconds(-2),
            after.AddMinutes(1).AddSeconds(2));
        Assert.True(msg.CanRetry);
        Assert.False(msg.IsDeadLettered);
    }

    [Fact]
    [Trait("TestType", "Outbox")]
    [Trait("TestType", "Regression")]
    public void SecondFailure_BacksOffFiveMinutes()
    {
        var msg = NewMessage();
        msg.MarkAsFailed("first");
        msg.MarkAsFailed("second");

        Assert.Equal(OutboxMessageStatus.Pending, msg.Status);
        Assert.Equal(2, msg.RetryCount);
        Assert.NotNull(msg.NextRetryUtc);
        Assert.True(msg.NextRetryUtc!.Value > DateTime.UtcNow.AddMinutes(4));
        Assert.True(msg.NextRetryUtc!.Value < DateTime.UtcNow.AddMinutes(6));
        Assert.True(msg.CanRetry);
    }

    [Fact]
    [Trait("TestType", "Outbox")]
    [Trait("TestType", "Security")]
    [Trait("TestType", "Regression")]
    public void RetryBudgetExhaustion_AutoTransitionsToDeadLettered_ClearsNextRetryUtc()
    {
        var msg = NewMessage();
        msg.MarkAsFailed("attempt 1");
        msg.MarkAsFailed("attempt 2");
        msg.MarkAsFailed("attempt 3 — final");

        // The terminal-state contract the OutboxProcessor polling WHERE clause
        // depends on: Status MUST be DeadLettered AND NextRetryUtc MUST be null
        // so `Status == Failed && NextRetryUtc <= now` cannot re-pick this row.
        Assert.Equal(OutboxMessageStatus.DeadLettered, msg.Status);
        Assert.Null(msg.NextRetryUtc);
        Assert.Equal(MaxRetries, msg.RetryCount);
        Assert.Equal("attempt 3 — final", msg.Error);
        Assert.False(msg.CanRetry);
        Assert.True(msg.IsDeadLettered);
    }

    [Fact]
    [Trait("TestType", "Outbox")]
    [Trait("TestType", "Regression")]
    public void MarkAsDeadLettered_SkipsRetryBudget()
    {
        var msg = NewMessage();
        msg.MarkAsDeadLettered("type 'Planora.Foo.OldEventV1' not found");

        Assert.Equal(OutboxMessageStatus.DeadLettered, msg.Status);
        Assert.Equal("type 'Planora.Foo.OldEventV1' not found", msg.Error);
        Assert.Null(msg.NextRetryUtc);
        Assert.Equal(0, msg.RetryCount); // retry budget was never consumed
        Assert.False(msg.CanRetry);
        Assert.True(msg.IsDeadLettered);
    }

    [Fact]
    [Trait("TestType", "Outbox")]
    [Trait("TestType", "Regression")]
    public void MarkAsDeadLettered_AfterPartialRetries_PreservesRetryCount()
    {
        var msg = NewMessage();
        msg.MarkAsFailed("attempt 1");
        msg.MarkAsFailed("attempt 2");
        // Operator decides this is a poison message — skip the remaining budget.
        msg.MarkAsDeadLettered("schema rejected by downstream contract");

        Assert.Equal(OutboxMessageStatus.DeadLettered, msg.Status);
        Assert.Equal(2, msg.RetryCount);
        Assert.Equal("schema rejected by downstream contract", msg.Error);
        Assert.Null(msg.NextRetryUtc);
        Assert.True(msg.IsDeadLettered);
        Assert.False(msg.CanRetry);
    }

    [Fact]
    [Trait("TestType", "Outbox")]
    [Trait("TestType", "Regression")]
    public void DeadLetteredMessage_IsNotPickedByPollingPredicate()
    {
        // Reproduces the OutboxProcessor polling WHERE clause:
        //   Status == Pending OR (Status == Failed && NextRetryUtc <= UtcNow)
        var msg = NewMessage();
        msg.MarkAsFailed("attempt 1");
        msg.MarkAsFailed("attempt 2");
        msg.MarkAsFailed("attempt 3");

        var matchesPending = msg.Status == OutboxMessageStatus.Pending;
        var matchesFailedReady =
            msg.Status == OutboxMessageStatus.Failed &&
            msg.NextRetryUtc.HasValue &&
            msg.NextRetryUtc.Value <= DateTime.UtcNow;

        // Both predicates must reject the dead-lettered row — the historical
        // bug was that the second predicate accepted it.
        Assert.False(matchesPending);
        Assert.False(matchesFailedReady);
    }

    [Fact]
    [Trait("TestType", "Outbox")]
    public void CanRetry_FalseOnceProcessed()
    {
        var msg = NewMessage();
        msg.MarkAsProcessed();
        Assert.False(msg.CanRetry);
    }

    [Fact]
    [Trait("TestType", "Outbox")]
    [Trait("TestType", "Regression")]
    public void ReclaimForRetry_FromStuckProcessing_GoesBackToPendingImmediately()
    {
        // Reproduces a crash between MarkAsProcessing+Save and MarkAsProcessed: the row is left in
        // Processing, which the polling query never selects. The sweep reclaims it to Pending with no
        // back-off delay so it is re-published on the next pass (at-least-once, INV-COMM-3a).
        var msg = NewMessage();
        msg.MarkAsProcessing();
        Assert.Equal(OutboxMessageStatus.Processing, msg.Status);

        msg.ReclaimForRetry();

        Assert.Equal(OutboxMessageStatus.Pending, msg.Status);
        Assert.Null(msg.NextRetryUtc);
        Assert.Equal(1, msg.RetryCount);
        Assert.True(msg.CanRetry);
        Assert.False(msg.IsDeadLettered);
        // The reclaimed row now satisfies the processor's polling predicate again.
        Assert.True(msg.Status == OutboxMessageStatus.Pending);
    }

    [Fact]
    [Trait("TestType", "Outbox")]
    [Trait("TestType", "Regression")]
    public void ReclaimForRetry_RepeatedlyCrashing_EventuallyDeadLetters()
    {
        // A message that crashes the worker on every attempt must not wedge the loop forever; the
        // reclaim consumes the retry budget and dead-letters once it is exhausted.
        var msg = NewMessage();

        msg.MarkAsProcessing();
        msg.ReclaimForRetry(); // 1
        msg.MarkAsProcessing();
        msg.ReclaimForRetry(); // 2
        msg.MarkAsProcessing();
        msg.ReclaimForRetry(); // 3 — budget exhausted

        Assert.Equal(OutboxMessageStatus.DeadLettered, msg.Status);
        Assert.Null(msg.NextRetryUtc);
        Assert.Equal(MaxRetries, msg.RetryCount);
        Assert.False(msg.CanRetry);
        Assert.True(msg.IsDeadLettered);
    }

    private static OutboxMessage NewMessage() =>
        new(type: "Planora.Tests.SomeEvent", content: "{}", occurredOnUtc: DateTime.UtcNow);
}
