using Planora.BuildingBlocks.Infrastructure.Inbox;

namespace Planora.BuildingBlocks.Infrastructure.Retention.Policies
{
    /// <summary>
    /// Purges transactional-messaging bookkeeping rows that have done their job: outbox messages that were
    /// successfully published (<see cref="OutboxMessageStatus.Processed"/>) and inbox messages that were
    /// successfully consumed (<see cref="InboxMessageStatus.Processed"/>), once they are older than their
    /// configured window. Dead-lettered / failed rows are deliberately <b>kept</b> — they are rare and are
    /// exactly what an operator needs to investigate a delivery failure.
    /// </summary>
    /// <remarks>
    /// The same policy is registered in every service that owns an outbox and/or inbox; it self-adapts by
    /// checking which of the two entity types the resolved <c>DbContext</c> actually maps, so a
    /// consumer-only or producer-only service purges just the table it has. This closes the systemic leak
    /// where <c>IOutbox/IInboxRepository.DeleteProcessedMessagesAsync</c> existed but was never scheduled.
    /// </remarks>
    public sealed class ProcessedMessagePurgePolicy : IRetentionPolicy
    {
        private readonly IRetentionLock _lock;
        private readonly ILogger<ProcessedMessagePurgePolicy> _logger;

        public ProcessedMessagePurgePolicy(IRetentionLock retentionLock, ILogger<ProcessedMessagePurgePolicy> logger)
        {
            _lock = retentionLock;
            _logger = logger;
        }

        public string Name => "processed-message-purge";

        public bool IsEnabled(RetentionOptions options) => options.PurgeOutboxInbox;

        public async Task<RetentionResult> ExecuteAsync(
            IServiceProvider scopedServices,
            RetentionContext context,
            CancellationToken cancellationToken)
        {
            var db = scopedServices.GetRequiredService<DbContext>();

            var scanned = 0;
            var deleted = 0;
            var tripped = false;

            if (db.Model.FindEntityType(typeof(OutboxMessage)) is not null)
            {
                var cutoff = context.UtcNow.AddDays(-context.Options.OutboxProcessedDays);
                var result = await RetentionExecutor.RunAsync(
                    $"{Name}:outbox",
                    db,
                    _lock,
                    context,
                    ct => RetentionExecutor.CountAsync<OutboxMessage>(
                        db, m => m.Status == OutboxMessageStatus.Processed && m.ProcessedOnUtc < cutoff, ct),
                    (batch, ct) => RetentionExecutor.DeleteBatchByIdAsync<OutboxMessage>(
                        db, m => m.Status == OutboxMessageStatus.Processed && m.ProcessedOnUtc < cutoff, batch, ct),
                    _logger,
                    cancellationToken);

                scanned += result.Scanned;
                deleted += result.Deleted;
                tripped |= result.TrippedGuard;
            }

            if (db.Model.FindEntityType(typeof(InboxMessage)) is not null)
            {
                var cutoff = context.UtcNow.AddDays(-context.Options.InboxProcessedDays);
                var result = await RetentionExecutor.RunAsync(
                    $"{Name}:inbox",
                    db,
                    _lock,
                    context,
                    ct => RetentionExecutor.CountAsync<InboxMessage>(
                        db, m => m.Status == InboxMessageStatus.Processed && m.ProcessedOn < cutoff, ct),
                    (batch, ct) => RetentionExecutor.DeleteBatchByIdAsync<InboxMessage>(
                        db, m => m.Status == InboxMessageStatus.Processed && m.ProcessedOn < cutoff, batch, ct),
                    _logger,
                    cancellationToken);

                scanned += result.Scanned;
                deleted += result.Deleted;
                tripped |= result.TrippedGuard;
            }

            return new RetentionResult
            {
                PolicyName = Name,
                Scanned = scanned,
                Deleted = deleted,
                DryRun = context.Options.DryRun,
                TrippedGuard = tripped
            };
        }
    }
}
