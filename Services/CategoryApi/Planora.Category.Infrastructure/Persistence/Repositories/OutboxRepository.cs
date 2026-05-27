using Planora.BuildingBlocks.Application.Outbox;

namespace Planora.Category.Infrastructure.Persistence.Repositories
{
    /// <summary>
    /// Compatibility wrapper preserved during Phase 2 T2.3. The class is still
    /// registered in <c>Planora.Category.Infrastructure.DependencyInjection</c>
    /// for legacy compatibility, but the implementation now delegates to
    /// <see cref="Planora.BuildingBlocks.Infrastructure.Persistence.OutboxRepository{TContext}"/>.
    /// New wirings should switch to:
    /// <code>
    /// services.AddScoped&lt;IOutboxRepository,
    ///     Planora.BuildingBlocks.Infrastructure.Persistence.OutboxRepository&lt;CategoryDbContext&gt;&gt;();
    /// </code>
    /// </summary>
    [Obsolete("Register Planora.BuildingBlocks.Infrastructure.Persistence.OutboxRepository<CategoryDbContext> instead. Will be removed.")]
    public sealed class OutboxRepository : IOutboxRepository
    {
        private readonly Planora.BuildingBlocks.Infrastructure.Persistence.OutboxRepository<CategoryDbContext> _inner;

        public OutboxRepository(CategoryDbContext context)
        {
            _inner = new Planora.BuildingBlocks.Infrastructure.Persistence.OutboxRepository<CategoryDbContext>(context);
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
