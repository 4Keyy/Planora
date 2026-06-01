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
            // Read-only: password history is append-only and read only to compare against a new
            // password (reuse prevention) — never mutated, so no change tracking is needed.
            return await _context.Set<PasswordHistory>()
                .AsNoTracking()
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
