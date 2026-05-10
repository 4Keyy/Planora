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
            return await _context.LoginHistory
                .Where(lh => lh.UserId == userId)
                .OrderByDescending(lh => lh.LoginAt)
                .Take(count)
                .ToListAsync(cancellationToken);
        }

        public async Task<IReadOnlyList<LoginHistory>> GetRecentFailedAttemptsAsync(
            Guid userId,
            TimeSpan timeWindow,
            CancellationToken cancellationToken = default)
        {
            var since = DateTime.UtcNow.Subtract(timeWindow);

            return await _context.LoginHistory
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
