using Planora.Auth.Domain.Enums;

namespace Planora.Auth.Infrastructure.Persistence.Repositories
{
    public sealed class FriendshipRepository : BaseRepository<Friendship>, IFriendshipRepository
    {
        public FriendshipRepository(AuthDbContext context) : base(context)
        {
        }

        public async Task<Friendship?> GetFriendshipAsync(Guid userId1, Guid userId2, CancellationToken cancellationToken = default)
        {
            return await _context.Friendships
                .FirstOrDefaultAsync(f =>
                    (f.RequesterId == userId1 && f.AddresseeId == userId2) ||
                    (f.RequesterId == userId2 && f.AddresseeId == userId1),
                    cancellationToken);
        }

        public async Task<IReadOnlyList<Friendship>> GetFriendshipsForUserAsync(
            Guid userId,
            FriendshipStatus? status = null,
            CancellationToken cancellationToken = default)
        {
            var query = _context.Friendships
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

