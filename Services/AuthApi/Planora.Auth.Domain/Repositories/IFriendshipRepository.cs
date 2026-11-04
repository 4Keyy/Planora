using Planora.Auth.Domain.Entities;
using Planora.Auth.Domain.Enums;

namespace Planora.Auth.Domain.Repositories
{
    public interface IFriendshipRepository : IRepository<Friendship>
    {
        /// <summary>Commits a pending request, or returns the status of the existing active relationship.</summary>
        /// <returns>Null when the request was created.</returns>
        Task<FriendshipStatus?> TryCreatePendingAsync(Friendship candidate, CancellationToken cancellationToken = default);
        Task<Friendship?> GetFriendshipAsync(Guid userId1, Guid userId2, CancellationToken cancellationToken = default);
        Task<IReadOnlyList<Friendship>> GetFriendshipsForUserAsync(Guid userId, FriendshipStatus? status = null, CancellationToken cancellationToken = default);
        Task<bool> AreFriendsAsync(Guid userId1, Guid userId2, CancellationToken cancellationToken = default);
        Task<IReadOnlyList<Guid>> GetFriendIdsAsync(Guid userId, CancellationToken cancellationToken = default);
    }
}

