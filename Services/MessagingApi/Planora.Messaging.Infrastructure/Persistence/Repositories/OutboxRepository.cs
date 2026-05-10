namespace Planora.Messaging.Infrastructure.Persistence.Repositories
{
    public sealed class OutboxRepository : IOutboxRepository
    {
        private readonly MessagingDbContext _context;

        public OutboxRepository(MessagingDbContext context)
        {
            _context = context;
        }

        public async Task AddAsync(OutboxMessage message, CancellationToken cancellationToken = default)
        {
            await _context.OutboxMessages.AddAsync(message, cancellationToken);
            await _context.SaveChangesAsync(cancellationToken);
        }

        public async Task<IReadOnlyList<OutboxMessage>> GetPendingMessagesAsync(
            int batchSize,
            CancellationToken cancellationToken = default)
        {
            return await _context.OutboxMessages
                .Where(m => m.Status == OutboxMessageStatus.Pending ||
                           (m.Status == OutboxMessageStatus.Failed && m.RetryCount < 3))
                .OrderBy(m => m.OccurredOnUtc)
                .Take(batchSize)
                .ToListAsync(cancellationToken);
        }

        public async Task UpdateAsync(OutboxMessage message, CancellationToken cancellationToken = default)
        {
            _context.OutboxMessages.Update(message);
            await _context.SaveChangesAsync(cancellationToken);
        }

        public async Task DeleteProcessedMessagesAsync(
            DateTime olderThan,
            CancellationToken cancellationToken = default)
        {
            var processedMessages = await _context.OutboxMessages
                .Where(m => m.Status == OutboxMessageStatus.Processed &&
                           m.ProcessedOnUtc < olderThan)
                .ToListAsync(cancellationToken);

            _context.OutboxMessages.RemoveRange(processedMessages);
            await _context.SaveChangesAsync(cancellationToken);
        }
    }
}
