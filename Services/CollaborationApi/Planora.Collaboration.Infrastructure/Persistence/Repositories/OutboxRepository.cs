using Planora.BuildingBlocks.Application.Outbox;

namespace Planora.Collaboration.Infrastructure.Persistence.Repositories
{
    public sealed class OutboxRepository : IOutboxRepository
    {
        private readonly CollaborationDbContext _context;

        public OutboxRepository(CollaborationDbContext context)
        {
            _context = context;
        }

        public async Task AddAsync(OutboxMessage message, CancellationToken cancellationToken = default)
        {
            await _context.OutboxMessages.AddAsync(message, cancellationToken);
            await _context.SaveChangesAsync(cancellationToken);
        }

        public async Task<IReadOnlyList<OutboxMessage>> GetPendingMessagesAsync(int batchSize, CancellationToken cancellationToken = default)
        {
            return await _context.OutboxMessages
                .Where(m => m.Status == OutboxMessageStatus.Pending ||
                           (m.Status == OutboxMessageStatus.Failed && m.NextRetryUtc <= System.DateTime.UtcNow))
                .OrderBy(m => m.OccurredOnUtc)
                .Take(batchSize)
                .ToListAsync(cancellationToken);
        }

        public async Task UpdateAsync(OutboxMessage message, CancellationToken cancellationToken = default)
        {
            _context.OutboxMessages.Update(message);
            await _context.SaveChangesAsync(cancellationToken);
        }

        public async Task DeleteProcessedMessagesAsync(DateTime olderThan, CancellationToken cancellationToken = default)
        {
            var messagesToDelete = await _context.OutboxMessages
                .Where(m => m.Status == OutboxMessageStatus.Processed && m.ProcessedOnUtc < olderThan)
                .ToListAsync(cancellationToken);

            _context.OutboxMessages.RemoveRange(messagesToDelete);
            await _context.SaveChangesAsync(cancellationToken);
        }
    }
}
