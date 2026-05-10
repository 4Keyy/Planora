namespace Planora.Messaging.Application.Services
{
    public interface IFriendshipService
    {
        Task<bool> AreFriendsAsync(Guid userId1, Guid userId2, CancellationToken cancellationToken = default);
    }
}
