namespace Planora.Messaging.Infrastructure.Persistence.Repositories
{
    /// <summary>
    /// Compatibility wrapper preserved during Phase 2 T2.3. Messaging never
    /// registered this in DI; kept as a thin pass-through to
    /// <see cref="Planora.BuildingBlocks.Infrastructure.Persistence.OutboxRepository{TContext}"/>
    /// for one release. The pre-consolidation query used <c>RetryCount &lt; 3</c>
    /// (independent of <c>NextRetryUtc</c>), which conflicted with INV-COMM-3a's
    /// retry-with-backoff contract. The delegated canonical implementation has
    /// the correct semantics.
    /// </summary>
    [Obsolete("Register Planora.BuildingBlocks.Infrastructure.Persistence.OutboxRepository<MessagingDbContext> instead. Will be removed.")]
    public sealed class OutboxRepository : IOutboxRepository
    {
        private readonly Planora.BuildingBlocks.Infrastructure.Persistence.OutboxRepository<MessagingDbContext> _inner;

        public OutboxRepository(MessagingDbContext context)
        {
            _inner = new Planora.BuildingBlocks.Infrastructure.Persistence.OutboxRepository<MessagingDbContext>(context);
        }

        public Task AddAsync(OutboxMessage message, CancellationToken cancellationToken = default)
            => _inner.AddAsync(message, cancellationToken);

        public Task<IReadOnlyList<OutboxMessage>> GetPendingMessagesAsync(int batchSize, CancellationToken cancellationToken = default)
            => _inner.GetPendingMessagesAsync(batchSize, cancellationToken);

        public Task UpdateAsync(OutboxMessage message, CancellationToken cancellationToken = default)
            => _inner.UpdateAsync(message, cancellationToken);

        public Task DeleteProcessedMessagesAsync(DateTime olderThan, CancellationToken cancellationToken = default)
            => _inner.DeleteProcessedMessagesAsync(olderThan, cancellationToken);
    }
}
