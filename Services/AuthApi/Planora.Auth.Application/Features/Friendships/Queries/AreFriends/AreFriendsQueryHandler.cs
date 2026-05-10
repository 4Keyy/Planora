using Planora.Auth.Application.Common.Interfaces;
using Planora.BuildingBlocks.Application.Models;
using MediatR;

namespace Planora.Auth.Application.Features.Friendships.Queries.AreFriends
{
    public sealed class AreFriendsQueryHandler : IRequestHandler<AreFriendsQuery, Result<bool>>
    {
        private readonly IFriendshipRepository _friendshipRepository;

        public AreFriendsQueryHandler(IFriendshipRepository friendshipRepository)
        {
            _friendshipRepository = friendshipRepository;
        }

        public async Task<Result<bool>> Handle(AreFriendsQuery request, CancellationToken cancellationToken)
        {
            // We need to check if a friendship exists between these two users and is accepted
            // Since there is no direct method to check specific pair, we can fetch for one user and filter
            // Or ideally, the repository should have a method. Assuming it doesn't, we fetch for UserId1

            var friendships = await _friendshipRepository.GetFriendshipsForUserAsync(
                request.UserId1,
                Domain.Enums.FriendshipStatus.Accepted,
                cancellationToken);

            var isFriend = friendships.Any(f =>
                (f.RequesterId == request.UserId1 && f.AddresseeId == request.UserId2) ||
                (f.RequesterId == request.UserId2 && f.AddresseeId == request.UserId1));

            return Result.Success(isFriend);
        }
    }
}