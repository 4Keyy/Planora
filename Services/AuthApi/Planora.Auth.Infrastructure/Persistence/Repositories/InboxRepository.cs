using Planora.BuildingBlocks.Infrastructure.Inbox;

namespace Planora.Auth.Infrastructure.Persistence.Repositories;

public sealed class InboxRepository : IInboxRepository
{
    private readonly AuthDbContext _context;

    public InboxRepository(AuthDbContext context)
    {
        _context = context;
    }

    public async Task<InboxMessage?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default)
    {
        return await _context.InboxMessages
            .FirstOrDefaultAsync(m => m.Id == id, cancellationToken);
    }

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
    {
        return await _context.InboxMessages
            .AnyAsync(m => m.Id == id, cancellationToken);
    }

    public async Task DeleteProcessedMessagesAsync(DateTime olderThan, CancellationToken cancellationToken = default)
    {
        var messagesToDelete = await _context.InboxMessages
            .Where(m => m.Status == InboxMessageStatus.Processed && m.ProcessedOn < olderThan)
            .ToListAsync(cancellationToken);

        _context.InboxMessages.RemoveRange(messagesToDelete);
        await _context.SaveChangesAsync(cancellationToken);
    }
}