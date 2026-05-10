using Planora.Auth.Application.Common.Interfaces;
using Planora.BuildingBlocks.Application.Models;
using MediatR;

namespace Planora.Auth.Application.Features.Friendships.Queries.GetFriendIds
{
    public sealed class GetFriendIdsQueryHandler : IRequestHandler<GetFriendIdsQuery, Result<List<Guid>>>
    {
        private readonly IFriendshipRepository _friendshipRepository;

        public GetFriendIdsQueryHandler(IFriendshipRepository friendshipRepository)
        {
            _friendshipRepository = friendshipRepository;
        }

        public async Task<Result<List<Guid>>> Handle(GetFriendIdsQuery request, CancellationToken cancellationToken)
        {
            var friendships = await _friendshipRepository.GetFriendshipsForUserAsync(
                request.UserId,
                Domain.Enums.FriendshipStatus.Accepted,
                cancellationToken);

            var friendIds = friendships
                .Select(f => f.RequesterId == request.UserId ? f.AddresseeId : f.RequesterId)
                .ToList();

            return Result.Success(friendIds);
        }
    }
}