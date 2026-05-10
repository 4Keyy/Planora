namespace Planora.Auth.Infrastructure.Persistence.Repositories
{
    public sealed class PasswordHistoryRepository : BaseRepository<PasswordHistory>, IPasswordHistoryRepository
    {
        public PasswordHistoryRepository(AuthDbContext context) : base(context)
        {
        }

        public async Task<IReadOnlyList<PasswordHistory>> GetByUserIdAsync(
            Guid userId,
            int count,
            CancellationToken cancellationToken = default)
        {
            return await _context.Set<PasswordHistory>()
                .Where(ph => ph.UserId == userId)
                .OrderByDescending(ph => ph.ChangedAt)
                .Take(count)
                .ToListAsync(cancellationToken);
        }

        public async Task DeleteOldHistoryAsync(
            Guid userId,
            int keepCount,
            CancellationToken cancellationToken = default)
        {
            var allHistory = await _context.Set<PasswordHistory>()
                .Where(ph => ph.UserId == userId)
                .OrderByDescending(ph => ph.ChangedAt)
                .ToListAsync(cancellationToken);

            if (allHistory.Count > keepCount)
            {
                var toDelete = allHistory.Skip(keepCount).ToList();
                _context.Set<PasswordHistory>().RemoveRange(toDelete);
                await _context.SaveChangesAsync(cancellationToken);
            }
        }
    }
}
