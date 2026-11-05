using Microsoft.EntityFrameworkCore.Storage;
using Planora.Auth.Domain.Security;

namespace Planora.Auth.Infrastructure.Persistence.Repositories
{
    public sealed class RefreshTokenRepository : BaseRepository<RefreshToken>, IRefreshTokenRepository
    {
        public RefreshTokenRepository(AuthDbContext context) : base(context)
        {
        }

        public async Task<RefreshToken?> GetByTokenAsync(string token, CancellationToken cancellationToken = default)
        {
            // Tokens are stored hashed; look up by the hash of the presented raw token.
            var tokenHash = RefreshTokenHash.Of(token);
            return await _context.RefreshTokens
                .FirstOrDefaultAsync(rt => rt.Token == tokenHash, cancellationToken);
        }

        public async Task<bool> TryRevokeAsync(
            RefreshToken current,
            string ipAddress,
            string reason,
            CancellationToken cancellationToken = default)
        {
            var now = DateTime.UtcNow;
            var changed = await _context.RefreshTokens
                .Where(row => row.Id == current.Id && row.UserId == current.UserId &&
                    row.Token == current.Token && row.RevokedAt == null && row.ExpiresAt > now)
                .ExecuteUpdateAsync(update => update
                    .SetProperty(row => row.RevokedAt, now)
                    .SetProperty(row => row.RevokedByIp, ipAddress)
                    .SetProperty(row => row.RevokedReason, reason)
                    .SetProperty(row => row.ReplacedByToken, (string?)null), cancellationToken);
            return changed == 1;
        }

        public async Task<bool> TryRotateAsync(
            RefreshToken current,
            RefreshToken successor,
            string rotationReason,
            CancellationToken cancellationToken = default)
        {
            var strategy = _context.Database.CreateExecutionStrategy();
            var successorEntry = _context.RefreshTokens.Add(successor);
            try
            {
                return await strategy.ExecuteInTransactionAsync(
                    _context,
                    async (context, token) =>
                    {
                        await AuthSessionLock.AcquireAsync(context, current.UserId, token);
                        var now = DateTime.UtcNow;
                        var consumed = await context.RefreshTokens
                            .Where(row => row.Id == current.Id && row.Token == current.Token &&
                                row.RevokedAt == null && row.ExpiresAt > now)
                            .ExecuteUpdateAsync(update => update
                                .SetProperty(row => row.RevokedAt, now)
                                .SetProperty(row => row.RevokedByIp, successor.CreatedByIp)
                                .SetProperty(row => row.RevokedReason, rotationReason)
                                .SetProperty(row => row.ReplacedByToken, string.Empty), token);
                        if (consumed == 0)
                            return false;

                        // Flush the successor only after the old device row leaves the unique index.
                        // Keep the same successor pending if the execution strategy retries.
                        await context.SaveChangesAsync(acceptAllChangesOnSuccess: false, token);
                        return true;
                    },
                    (context, token) => context.RefreshTokens.AsNoTracking()
                        .AnyAsync(row => row.Id == successor.Id && row.Token == successor.Token, token),
                    cancellationToken);
            }
            finally
            {
                successorEntry.State = EntityState.Detached;
            }
        }

        public Task RevokeActiveAfterReplayAsync(
            Guid userId,
            string ipAddress,
            string reason,
            CancellationToken cancellationToken = default) =>
            _context.Database.CreateExecutionStrategy().ExecuteAsync(async token =>
            {
                await using var transaction = await _context.Database.BeginTransactionAsync(token);
                // Take the active-row snapshot after any in-flight rotation commits.
                await AuthSessionLock.AcquireAsync(_context, userId, token);
                var now = DateTime.UtcNow;
                await _context.RefreshTokens
                    .Where(row => row.UserId == userId && row.RevokedAt == null && row.ExpiresAt > now)
                    .ExecuteUpdateAsync(update => update
                        .SetProperty(row => row.RevokedAt, now)
                        .SetProperty(row => row.RevokedByIp, ipAddress)
                        .SetProperty(row => row.RevokedReason, reason)
                        .SetProperty(row => row.ReplacedByToken, (string?)null), token);
                await transaction.CommitAsync(token);
            }, cancellationToken);

        public async Task<IReadOnlyList<RefreshToken>> GetActiveTokensByUserIdAsync(
            Guid userId,
            CancellationToken cancellationToken = default)
        {
            // Read-only: the only callers (session list / security overview) project these to DTOs
            // and never mutate them, so change tracking is pure overhead here.
            return await _context.RefreshTokens
                .AsNoTracking()
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
