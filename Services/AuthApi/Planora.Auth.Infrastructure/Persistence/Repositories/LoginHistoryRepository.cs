namespace Planora.Auth.Infrastructure.Persistence.Repositories
{
    public sealed class LoginHistoryRepository : BaseRepository<LoginHistory>, ILoginHistoryRepository
    {
        public LoginHistoryRepository(AuthDbContext context) : base(context)
        {
        }

        public async Task<IReadOnlyList<LoginHistory>> GetByUserIdAsync(
            Guid userId,
            int count = 50,
            CancellationToken cancellationToken = default)
        {
            // Read-only: login history is append-only and these rows are only read (display /
            // lockout checks), never mutated — so no change tracking is needed.
            return await _context.LoginHistory
                .AsNoTracking()
                .Where(lh => lh.UserId == userId)
                .OrderByDescending(lh => lh.LoginAt)
                .Take(count)
                .ToListAsync(cancellationToken);
        }

        public async Task<(IReadOnlyList<LoginHistory> Items, int TotalCount)> GetPagedByUserIdAsync(
            Guid userId,
            int pageNumber,
            int pageSize,
            CancellationToken cancellationToken = default)
        {
            // Read-only display query: count and page both run in SQL so the total is exact and the
            // page never materialises more than `pageSize` rows, regardless of history size.
            var baseQuery = _context.LoginHistory
                .AsNoTracking()
                .Where(lh => lh.UserId == userId);

            var totalCount = await baseQuery.CountAsync(cancellationToken);

            var items = await baseQuery
                .OrderByDescending(lh => lh.LoginAt)
                .Skip(Math.Max(0, (pageNumber - 1) * pageSize))
                .Take(pageSize)
                .ToListAsync(cancellationToken);

            return (items, totalCount);
        }

        public async Task<IReadOnlyList<LoginHistory>> GetRecentFailedAttemptsAsync(
            Guid userId,
            TimeSpan timeWindow,
            CancellationToken cancellationToken = default)
        {
            var since = DateTime.UtcNow.Subtract(timeWindow);

            return await _context.LoginHistory
                .AsNoTracking()
                .Where(lh => lh.UserId == userId && !lh.IsSuccessful && lh.LoginAt >= since)
                .OrderByDescending(lh => lh.LoginAt)
                .ToListAsync(cancellationToken);
        }

        public async Task DeleteOldHistoryAsync(DateTime olderThan, CancellationToken cancellationToken = default)
        {
            var oldHistory = await _context.LoginHistory
                .Where(lh => lh.LoginAt < olderThan)
                .ToListAsync(cancellationToken);

            _context.LoginHistory.RemoveRange(oldHistory);
            await _context.SaveChangesAsync(cancellationToken);
        }
    }
}
