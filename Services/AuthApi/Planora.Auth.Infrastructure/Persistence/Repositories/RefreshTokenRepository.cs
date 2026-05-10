namespace Planora.Auth.Infrastructure.Persistence.Repositories
{
    public sealed class RefreshTokenRepository : BaseRepository<RefreshToken>, IRefreshTokenRepository
    {
        public RefreshTokenRepository(AuthDbContext context) : base(context)
        {
        }

        public async Task<RefreshToken?> GetByTokenAsync(string token, CancellationToken cancellationToken = default)
        {
            return await _context.RefreshTokens
                .FirstOrDefaultAsync(rt => rt.Token == token, cancellationToken);
        }

        public async Task<IReadOnlyList<RefreshToken>> GetActiveTokensByUserIdAsync(
            Guid userId,
            CancellationToken cancellationToken = default)
        {
            return await _context.RefreshTokens
                .Where(rt => rt.UserId == userId && rt.RevokedAt == null && rt.ExpiresAt > DateTime.UtcNow)
                .OrderByDescending(rt => rt.CreatedAt)
                .ToListAsync(cancellationToken);
        }

        public async Task DeleteExpiredTokensAsync(DateTime olderThan, CancellationToken cancellationToken = default)
        {
            var expiredTokens = await _context.RefreshTokens
                .Where(rt => rt.ExpiresAt < olderThan)
                .ToListAsync(cancellationToken);

            _context.RefreshTokens.RemoveRange(expiredTokens);
            await _context.SaveChangesAsync(cancellationToken);
        }

        public async Task<RefreshToken?> FindActiveByUserAndDeviceAsync(
            Guid userId,
            string deviceFingerprint,
            CancellationToken cancellationToken = default)
        {
            return await _context.RefreshTokens
                .Where(t => t.UserId == userId
                         && t.DeviceFingerprint == deviceFingerprint
                         && !t.RevokedAt.HasValue
                         && t.ExpiresAt > DateTime.UtcNow)
                .FirstOrDefaultAsync(cancellationToken);
        }
    }
}
