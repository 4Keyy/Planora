using Microsoft.EntityFrameworkCore;
using Planora.Auth.Domain.Entities;
using Planora.Auth.Domain.Repositories;

namespace Planora.Auth.Infrastructure.Persistence.Repositories
{
    public sealed class UserRecoveryCodeRepository : BaseRepository<UserRecoveryCode>, IUserRecoveryCodeRepository
    {
        public UserRecoveryCodeRepository(AuthDbContext context) : base(context)
        {
        }

        public async Task<IReadOnlyList<UserRecoveryCode>> GetUnusedByUserIdAsync(
            Guid userId,
            CancellationToken cancellationToken = default)
        {
            return await _context.Set<UserRecoveryCode>()
                .AsNoTracking()
                .Where(rc => rc.UserId == userId && !rc.IsUsed && !rc.IsDeleted)
                .ToListAsync(cancellationToken);
        }

        public async Task<bool> TryConsumeAsync(
            Guid userId,
            Guid codeId,
            string expectedHash,
            CancellationToken cancellationToken = default)
        {
            var usedAt = DateTime.UtcNow;
            var changed = await _context.Set<UserRecoveryCode>()
                .Where(code => code.UserId == userId && code.Id == codeId &&
                    code.CodeHash == expectedHash && !code.IsUsed && !code.IsDeleted)
                .ExecuteUpdateAsync(update => update
                    .SetProperty(code => code.IsUsed, true)
                    .SetProperty(code => code.UsedAt, usedAt)
                    .SetProperty(code => code.UpdatedAt, usedAt)
                    .SetProperty(code => code.UpdatedBy, userId), cancellationToken);
            return changed == 1;
        }

        public async Task DeleteAllForUserAsync(
            Guid userId,
            CancellationToken cancellationToken = default)
        {
            var codes = await _context.Set<UserRecoveryCode>()
                .Where(rc => rc.UserId == userId)
                .ToListAsync(cancellationToken);

            if (codes.Count > 0)
            {
                _context.Set<UserRecoveryCode>().RemoveRange(codes);
                await _context.SaveChangesAsync(cancellationToken);
            }
        }
    }
}
