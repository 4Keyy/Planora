namespace Planora.BuildingBlocks.Infrastructure.Persistence;

/// <summary>
/// Canonical outbox repository. Picks up <see cref="OutboxMessageStatus.Pending"/>
/// rows plus retry-eligible <see cref="OutboxMessageStatus.Failed"/> rows whose
/// <c>NextRetryUtc</c> has elapsed. Terminal <see cref="OutboxMessageStatus.DeadLettered"/>
/// rows are never picked up — they require operator action (see INV-COMM-3a).
/// </summary>
/// <remarks>
/// Service-side per-DbContext implementations are <c>[Obsolete]</c> adapters kept
/// for one release to ease the consolidation. New wirings should register
/// <c>OutboxRepository&lt;TContext&gt;</c> directly:
/// <code>
/// services.AddScoped&lt;IOutboxRepository, OutboxRepository&lt;CategoryDbContext&gt;&gt;();
/// </code>
/// </remarks>
public sealed class OutboxRepository<TContext> : IOutboxRepository
    where TContext : DbContext
{
    private readonly TContext _context;

    public OutboxRepository(TContext context)
    {
        _context = context ?? throw new ArgumentNullException(nameof(context));
    }

    public async Task AddAsync(OutboxMessage message, CancellationToken cancellationToken = default)
    {
        await _context.Set<OutboxMessage>().AddAsync(message, cancellationToken);
        await _context.SaveChangesAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<OutboxMessage>> GetPendingMessagesAsync(
        int batchSize,
        CancellationToken cancellationToken = default)
    {
        // Capture "now" once so the predicate is deterministic for the duration of
        // the query — EF Core does not necessarily inline DateTime.UtcNow as a
        // server-side function across providers.
        var now = DateTime.UtcNow;
        return await _context.Set<OutboxMessage>()
            .Where(m => m.Status == OutboxMessageStatus.Pending ||
                       (m.Status == OutboxMessageStatus.Failed && m.NextRetryUtc <= now))
            .OrderBy(m => m.OccurredOnUtc)
            .Take(batchSize)
            .ToListAsync(cancellationToken);
    }

    public async Task UpdateAsync(OutboxMessage message, CancellationToken cancellationToken = default)
    {
        _context.Set<OutboxMessage>().Update(message);
        await _context.SaveChangesAsync(cancellationToken);
    }

    public async Task DeleteProcessedMessagesAsync(DateTime olderThan, CancellationToken cancellationToken = default)
    {
        var messagesToDelete = await _context.Set<OutboxMessage>()
            .Where(m => m.Status == OutboxMessageStatus.Processed && m.ProcessedOnUtc < olderThan)
            .ToListAsync(cancellationToken);

        _context.Set<OutboxMessage>().RemoveRange(messagesToDelete);
        await _context.SaveChangesAsync(cancellationToken);
    }
}
