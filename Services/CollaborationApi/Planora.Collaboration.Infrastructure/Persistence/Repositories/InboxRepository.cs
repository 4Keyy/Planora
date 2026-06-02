using Planora.BuildingBlocks.Infrastructure.Inbox;

namespace Planora.Collaboration.Infrastructure.Persistence.Repositories
{
    /// <summary>
    /// Inbox store backing consumer idempotency. The event bus checks <see cref="ExistsAsync"/>
    /// (keyed on the event id, which is the PK) before invoking a handler and records the event
    /// after the handler succeeds.
    /// </summary>
    public sealed class InboxRepository : IInboxRepository
    {
        private readonly CollaborationDbContext _context;

        public InboxRepository(CollaborationDbContext context)
        {
            _context = context;
        }

        public async Task<InboxMessage?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default)
            => await _context.InboxMessages.FirstOrDefaultAsync(m => m.Id == id, cancellationToken);

        public async Task AddAsync(InboxMessage message, CancellationToken cancellationToken = default)
        {
            await _context.InboxMessages.AddAsync(message, cancellationToken);
            await _context.SaveChangesAsync(cancellationToken);
        }

        public async Task UpdateAsync(InboxMessage message, CancellationToken cancellationToken = default)
        {
            _context.InboxMessages.Update(message);
            await _context.SaveChangesAsync(cancellationToken);
        }

        public async Task<bool> ExistsAsync(Guid id, CancellationToken cancellationToken = default)
            => await _context.InboxMessages.AnyAsync(m => m.Id == id, cancellationToken);

        public async Task DeleteProcessedMessagesAsync(DateTime olderThan, CancellationToken cancellationToken = default)
        {
            var processed = await _context.InboxMessages
                .Where(m => m.Status == InboxMessageStatus.Processed
                    && m.ProcessedOn.HasValue && m.ProcessedOn.Value < olderThan)
                .ToListAsync(cancellationToken);

            _context.InboxMessages.RemoveRange(processed);
            await _context.SaveChangesAsync(cancellationToken);
        }
    }
}
