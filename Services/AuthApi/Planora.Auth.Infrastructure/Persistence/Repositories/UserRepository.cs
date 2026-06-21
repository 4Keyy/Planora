using Planora.Auth.Domain.Entities;
using Planora.Auth.Domain.Enums;
using Planora.Auth.Domain.Events;
using Planora.Auth.Domain.Repositories;
using Planora.BuildingBlocks.Infrastructure.Configuration;

namespace Planora.Auth.Infrastructure.Persistence.Repositories
{
    public sealed class UserRepository : BaseRepository<User>, IUserRepository
    {
        public UserRepository(AuthDbContext context) : base(context)
        {
        }

        public async Task<User?> GetByEmailAsync(Email email, CancellationToken cancellationToken = default)
        {
            return await _context.Users
                .FirstOrDefaultAsync(u => u.Email.Value == email.Value, cancellationToken);
        }

        public async Task<bool> ExistsByEmailAsync(Email email, CancellationToken cancellationToken = default)
        {
            return await _context.Users
                .AnyAsync(u => u.Email.Value == email.Value, cancellationToken);
        }

        public async Task<User?> GetWithRefreshTokensAsync(Guid userId, CancellationToken cancellationToken = default)
        {
            return await _context.Users
                .Include(u => u.RefreshTokens)
                .FirstOrDefaultAsync(u => u.Id == userId, cancellationToken);
        }

        public async Task<User?> GetByRefreshTokenAsync(string refreshToken, CancellationToken cancellationToken = default)
        {
            return await _context.Users
                .Include(u => u.RefreshTokens)
                .FirstOrDefaultAsync(u => u.RefreshTokens.Any(rt => rt.Token == refreshToken), cancellationToken);
        }

        public async Task<User?> GetByPasswordResetTokenAsync(string tokenHash, CancellationToken cancellationToken = default)
        {
            return await _context.Users
                .Include(u => u.RefreshTokens)
                .FirstOrDefaultAsync(u => u.PasswordResetToken == tokenHash, cancellationToken);
        }

        public async Task<User?> GetByEmailVerificationTokenAsync(string tokenHash, CancellationToken cancellationToken = default)
        {
            return await _context.Users
                .FirstOrDefaultAsync(u => u.EmailVerificationToken == tokenHash, cancellationToken);
        }

        public async Task<User?> GetWithLoginHistoryAsync(Guid userId, int count = 10, CancellationToken cancellationToken = default)
        {
            var user = await _context.Users
                .FirstOrDefaultAsync(u => u.Id == userId, cancellationToken);

            if (user != null)
            {
                await _context.Entry(user)
                    .Collection(u => u.LoginHistory)
                    .Query()
                    .OrderByDescending(lh => lh.LoginAt)
                    .Take(count)
                    .LoadAsync(cancellationToken);
            }

            return user;
        }

        public async Task<IReadOnlyList<User>> GetByIdsAsync(IEnumerable<Guid> ids, CancellationToken cancellationToken = default)
        {
            var idList = ids.Distinct().ToList();
            if (idList.Count == 0)
                return [];

            return await _context.Users
                .AsNoTracking()
                .Where(u => idList.Contains(u.Id))
                .ToListAsync(cancellationToken);
        }

        public async Task<UserStatisticsSnapshot> GetStatisticsAsync(
            DateTime todayUtc,
            DateTime weekAgoUtc,
            DateTime monthAgoUtc,
            CancellationToken cancellationToken = default)
        {
            // Single grouped aggregate query: PostgreSQL scans the (filtered) users table once
            // and returns all eight counts. No rows are pulled into memory.
            var raw = await _context.Users
                .AsNoTracking()
                .GroupBy(_ => 1)
                .Select(g => new
                {
                    Total = g.Count(),
                    Active = g.Count(u => u.Status == UserStatus.Active),
                    Inactive = g.Count(u => u.Status == UserStatus.Inactive),
                    Locked = g.Count(u => u.Status == UserStatus.Locked),
                    TwoFactor = g.Count(u => u.TwoFactorEnabled),
                    Today = g.Count(u => u.CreatedAt >= todayUtc),
                    Week = g.Count(u => u.CreatedAt >= weekAgoUtc),
                    Month = g.Count(u => u.CreatedAt >= monthAgoUtc)
                })
                .FirstOrDefaultAsync(cancellationToken);

            return raw is null
                ? UserStatisticsSnapshot.Empty
                : new UserStatisticsSnapshot(
                    raw.Total, raw.Active, raw.Inactive, raw.Locked,
                    raw.TwoFactor, raw.Today, raw.Week, raw.Month);
        }

        public async Task<(IReadOnlyList<User> Items, int TotalCount)> GetPagedAsync(
            UserListFilter filter,
            CancellationToken cancellationToken = default)
        {
            var query = _context.Users.AsNoTracking();

            if (filter.Status.HasValue)
            {
                query = query.Where(u => u.Status == filter.Status.Value);
            }

            if (!string.IsNullOrWhiteSpace(filter.SearchTerm))
            {
                var term = filter.SearchTerm.ToLower();
                query = query.Where(u =>
                    u.Email.Value.ToLower().Contains(term) ||
                    u.FirstName.ToLower().Contains(term) ||
                    u.LastName.ToLower().Contains(term));
            }

            if (filter.CreatedFrom.HasValue)
            {
                query = query.Where(u => u.CreatedAt >= filter.CreatedFrom.Value);
            }

            if (filter.CreatedTo.HasValue)
            {
                query = query.Where(u => u.CreatedAt <= filter.CreatedTo.Value);
            }

            // Count before paging so TotalCount reflects the full filtered set.
            var totalCount = await query.CountAsync(cancellationToken);

            query = filter.OrderBy?.ToLower() switch
            {
                "email" => filter.Ascending
                    ? query.OrderBy(u => u.Email.Value)
                    : query.OrderByDescending(u => u.Email.Value),
                "firstname" => filter.Ascending
                    ? query.OrderBy(u => u.FirstName)
                    : query.OrderByDescending(u => u.FirstName),
                "lastname" => filter.Ascending
                    ? query.OrderBy(u => u.LastName)
                    : query.OrderByDescending(u => u.LastName),
                _ => filter.Ascending
                    ? query.OrderBy(u => u.CreatedAt)
                    : query.OrderByDescending(u => u.CreatedAt)
            };

            var pageNumber = filter.PageNumber < 1 ? 1 : filter.PageNumber;
            var pageSize = filter.PageSize < 1 ? 1 : filter.PageSize;

            var items = await query
                .Skip((pageNumber - 1) * pageSize)
                .Take(pageSize)
                .ToListAsync(cancellationToken);

            return (items, totalCount);
        }

        public async Task HandleFailedLoginAsync(Guid userId, CancellationToken cancellationToken = default)
        {
            var user = await _context.Users.FindAsync(new object[] { userId }, cancellationToken);
            if (user == null) return;

            user.IncrementFailedLoginAttempts();
            if (user.FailedLoginAttempts >= SecurityConstants.SecurityPolicies.MaxFailedLoginAttempts)
            {
                user.LockAccount(SecurityConstants.SecurityPolicies.AccountLockoutMinutes);
            }

            await _context.SaveChangesAsync(cancellationToken);
        }
    }
}
