namespace Planora.Todo.Application.Services
{
    public interface IFriendshipService
    {
        Task<IReadOnlyList<Guid>> GetFriendIdsAsync(Guid userId, CancellationToken cancellationToken = default);
        /// <summary>Fresh accepted friendships for materialized audiences; never cached.</summary>
        Task<IReadOnlyList<FriendshipInfo>> GetFriendshipsAsync(Guid userId, CancellationToken cancellationToken = default);
        Task<bool> AreFriendsAsync(Guid userId1, Guid userId2, CancellationToken cancellationToken = default);
    }
}

