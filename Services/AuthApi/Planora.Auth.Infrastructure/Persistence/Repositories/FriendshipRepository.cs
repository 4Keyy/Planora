using System.Data;
using Planora.Auth.Domain.Enums;

namespace Planora.Auth.Infrastructure.Persistence.Repositories
{
    public sealed class FriendshipRepository : BaseRepository<Friendship>, IFriendshipRepository
    {
        public FriendshipRepository(AuthDbContext context) : base(context)
        {
        }

        public async Task<FriendshipStatus?> TryCreatePendingAsync(
            Friendship candidate,
            CancellationToken cancellationToken = default)
        {
            var first = candidate.RequesterId;
            var second = candidate.AddresseeId;
            if (first.CompareTo(second) > 0)
                (first, second) = (second, first);

            var lockName = $"planora.auth.friendship:{first:N}:{second:N}";
            try
            {
                return await _context.Database.CreateExecutionStrategy().ExecuteInTransactionAsync(
                    _context,
                    async (context, token) =>
                    {
                        await context.Database.ExecuteSqlInterpolatedAsync(
                            $"SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended({lockName}, 0))", token);
                        // Read in a separate statement so it sees the preceding lock holder's commit.
                        var existingStatus = await ForPair(first, second)
                            .Where(f => f.Status == FriendshipStatus.Accepted || f.Status == FriendshipStatus.Pending)
                            .OrderByDescending(f => f.Status == FriendshipStatus.Accepted)
                            .Select(f => (FriendshipStatus?)f.Status)
                            .FirstOrDefaultAsync(token);
                        if (existingStatus.HasValue)
                            return existingStatus;

                        context.Friendships.Add(candidate);
                        await context.SaveChangesAsync(acceptAllChangesOnSuccess: false, token);
                        return null;
                    },
                    (context, token) => context.Friendships.IgnoreQueryFilters()
                        .AnyAsync(f => f.Id == candidate.Id, token),
                    IsolationLevel.ReadCommitted,
                    cancellationToken);
            }
            finally
            {
                _context.Entry(candidate).State = EntityState.Detached;
            }
        }

        private IQueryable<Friendship> ForPair(Guid first, Guid second) =>
            _context.Friendships.Where(f =>
                (f.RequesterId == first && f.AddresseeId == second) ||
                (f.RequesterId == second && f.AddresseeId == first));

        public Task<Friendship?> GetFriendshipAsync(Guid userId1, Guid userId2, CancellationToken cancellationToken = default) =>
            ForPair(userId1, userId2)
                .OrderByDescending(f => f.Status == FriendshipStatus.Accepted)
                .ThenByDescending(f => f.Status == FriendshipStatus.Pending)
                .ThenByDescending(f => f.CreatedAt)
                .ThenBy(f => f.Id)
                .FirstOrDefaultAsync(cancellationToken);

        public async Task<IReadOnlyList<Friendship>> GetFriendshipsForUserAsync(
            Guid userId,
            FriendshipStatus? status = null,
            CancellationToken cancellationToken = default)
        {
            // Read-only: consumed by the GetFriends / GetFriendRequests query handlers, which only
            // project to DTOs. AsNoTracking avoids needless change-tracking. (Mutations load the
            // single row via GetFriendshipAsync / GetByIdAsync, which stay tracked.)
            var query = _context.Friendships
                .AsNoTracking()
                .Where(f => f.RequesterId == userId || f.AddresseeId == userId);

            if (status.HasValue)
            {
                query = query.Where(f => f.Status == status.Value);
            }

            return await query.ToListAsync(cancellationToken);
        }

        public async Task<bool> AreFriendsAsync(Guid userId1, Guid userId2, CancellationToken cancellationToken = default)
        {
            return await _context.Friendships
                .AnyAsync(f =>
                    ((f.RequesterId == userId1 && f.AddresseeId == userId2) ||
                     (f.RequesterId == userId2 && f.AddresseeId == userId1)) &&
                    f.Status == FriendshipStatus.Accepted,
                    cancellationToken);
        }

        public async Task<IReadOnlyList<Guid>> GetFriendIdsAsync(Guid userId, CancellationToken cancellationToken = default)
        {
            var friendships = await _context.Friendships
                .AsNoTracking()
                .Where(f =>
                    (f.RequesterId == userId || f.AddresseeId == userId) &&
                    f.Status == FriendshipStatus.Accepted)
                .ToListAsync(cancellationToken);

            return friendships
                .Select(f => f.RequesterId == userId ? f.AddresseeId : f.RequesterId)
                .ToList();
        }
    }
}

