namespace Planora.Auth.Infrastructure.Persistence.Repositories;

/// <summary>
/// Compatibility wrapper preserved during Phase 2 T2.3. Auth never registered this
/// repository in DI (no <c>services.AddScoped&lt;IOutboxRepository&gt;</c> in Auth's
/// <c>DependencyInjection</c>) but the type was present in two prior audits, so we
/// keep it as a thin pass-through to the canonical
/// <see cref="Planora.BuildingBlocks.Infrastructure.Persistence.OutboxRepository{TContext}"/>
/// for one release. The pre-consolidation query was buggy — it never picked up
/// <c>Failed</c>-with-<c>NextRetryUtc</c> rows; the canonical implementation has
/// the correct INV-COMM-3a polling predicate.
/// </summary>
[Obsolete("Register Planora.BuildingBlocks.Infrastructure.Persistence.OutboxRepository<AuthDbContext> instead. Will be removed.")]
public sealed class OutboxRepository : IOutboxRepository
{
    private readonly Planora.BuildingBlocks.Infrastructure.Persistence.OutboxRepository<AuthDbContext> _inner;

    public OutboxRepository(AuthDbContext context)
    {
        _inner = new Planora.BuildingBlocks.Infrastructure.Persistence.OutboxRepository<AuthDbContext>(context);
    }

    public Task AddAsync(OutboxMessage message, CancellationToken cancellationToken = default)
        => _inner.AddAsync(message, cancellationToken);

    public Task<IReadOnlyList<OutboxMessage>> GetPendingMessagesAsync(int batchSize, CancellationToken cancellationToken = default)
        => _inner.GetPendingMessagesAsync(batchSize, cancellationToken);

    public Task UpdateAsync(OutboxMessage message, CancellationToken cancellationToken = default)
        => _inner.UpdateAsync(message, cancellationToken);

    public Task DeleteProcessedMessagesAsync(DateTime olderThan, CancellationToken cancellationToken = default)
        => _inner.DeleteProcessedMessagesAsync(olderThan, cancellationToken);

    /// <summary>
    /// Historical alias retained for callers that expected the "GetUnprocessed" name.
    /// Returns a concrete <see cref="List{T}"/> — callers that depended on the
    /// concrete type continue to compile.
    /// </summary>
    public async Task<List<OutboxMessage>> GetUnprocessedMessagesAsync(
        int batchSize = 10,
        CancellationToken cancellationToken = default)
    {
        var pending = await _inner.GetPendingMessagesAsync(batchSize, cancellationToken);
        return [.. pending];
    }
}
