using Planora.BuildingBlocks.Infrastructure.Persistence;
using Planora.Messaging.Domain;
using Planora.BuildingBlocks.Application.Pagination;

namespace Planora.Messaging.Infrastructure.Persistence.Repositories
{
    public sealed class MessageRepository : BaseRepository<Message, Guid, MessagingDbContext>, IMessageRepository
    {
        public MessageRepository(MessagingDbContext context)
            : base(context)
        {
        }

        public async Task<IReadOnlyList<Message>> GetSentByUserAsync(Guid userId, CancellationToken cancellationToken = default)
        {
            return await DbSet
                .AsNoTracking()
                .Where(m => m.SenderId == userId)
                .OrderByDescending(m => m.CreatedAt)
                .ToListAsync(cancellationToken);
        }

        public async Task<IReadOnlyList<Message>> GetReceivedByUserAsync(Guid userId, CancellationToken cancellationToken = default)
        {
            return await DbSet
                .AsNoTracking()
                .Where(m => m.RecipientId == userId && !m.IsArchived)
                .OrderByDescending(m => m.CreatedAt)
                .ToListAsync(cancellationToken);
        }

        public async Task<IReadOnlyList<Message>> GetConversationAsync(Guid userId1, Guid userId2, CancellationToken cancellationToken = default)
        {
            return await DbSet
                .AsNoTracking()
                .Where(m => (m.SenderId == userId1 && m.RecipientId == userId2) ||
                           (m.SenderId == userId2 && m.RecipientId == userId1))
                .OrderBy(m => m.CreatedAt)
                .ToListAsync(cancellationToken);
        }

        public async Task<(IReadOnlyList<Message> Items, int TotalCount)> GetConversationPagedAsync(
            Guid userId1,
            Guid userId2,
            int page,
            int pageSize,
            CancellationToken cancellationToken = default)
        {
            var (safePageNumber, safePageSize) = PaginationParameters.Normalize(page, pageSize);
            var query = DbSet
                .AsNoTracking()
                .Where(m => (m.SenderId == userId1 && m.RecipientId == userId2) ||
                            (m.SenderId == userId2 && m.RecipientId == userId1));

            var totalCount = await query.CountAsync(cancellationToken);

            var items = await query
                .OrderByDescending(m => m.CreatedAt)
                .Skip((safePageNumber - 1) * safePageSize)
                .Take(safePageSize)
                .ToListAsync(cancellationToken);

            return (items, totalCount);
        }

        public async Task<int> GetUnreadCountAsync(Guid recipientId, CancellationToken cancellationToken = default)
        {
            return await DbSet
                .AsNoTracking()
                .CountAsync(m => m.RecipientId == recipientId && m.ReadAt == null, cancellationToken);
        }
    }
}
