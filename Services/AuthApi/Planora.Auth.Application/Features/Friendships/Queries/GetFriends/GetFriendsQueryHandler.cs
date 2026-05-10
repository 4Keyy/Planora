using Planora.BuildingBlocks.Application.Models;
using Planora.BuildingBlocks.Application.Pagination;

namespace Planora.Auth.Application.Features.Friendships.Queries.GetFriends
{
    public sealed class GetFriendsQueryHandler : IRequestHandler<GetFriendsQuery, Result<PagedResult<FriendDto>>>
    {
        private readonly IFriendshipRepository _friendshipRepository;
        private readonly IUserRepository _userRepository;
        private readonly ICurrentUserService _currentUserService;
        private readonly ILogger<GetFriendsQueryHandler> _logger;

        public GetFriendsQueryHandler(
            IFriendshipRepository friendshipRepository,
            IUserRepository userRepository,
            ICurrentUserService currentUserService,
            ILogger<GetFriendsQueryHandler> logger)
        {
            _friendshipRepository = friendshipRepository;
            _userRepository = userRepository;
            _currentUserService = currentUserService;
            _logger = logger;
        }

        public async Task<Result<PagedResult<FriendDto>>> Handle(GetFriendsQuery request, CancellationToken cancellationToken)
        {
            if (!_currentUserService.UserId.HasValue)
                return Result.Failure<PagedResult<FriendDto>>("AUTH_REQUIRED", "User context is not available");

            var userId = _currentUserService.UserId.Value;

            try
            {
                var friendships = await _friendshipRepository.GetFriendshipsForUserAsync(
                    userId,
                    Domain.Enums.FriendshipStatus.Accepted,
                    cancellationToken);

                var friendIds = friendships
                    .Select(f => f.RequesterId == userId ? f.AddresseeId : f.RequesterId)
                    .ToList();

                var friends = new List<FriendDto>();
                foreach (var friendId in friendIds)
                {
                    var friend = await _userRepository.GetByIdAsync(friendId, cancellationToken);
                    if (friend != null)
                    {
                        var friendship = friendships.First(f =>
                            (f.RequesterId == userId && f.AddresseeId == friendId) ||
                            (f.RequesterId == friendId && f.AddresseeId == userId));

                        friends.Add(new FriendDto
                        {
                            Id = friend.Id,
                            Email = friend.Email.Value,
                            FirstName = friend.FirstName,
                            LastName = friend.LastName,
                            ProfilePictureUrl = friend.ProfilePictureUrl,
                            FriendsSince = friendship.AcceptedAt ?? friendship.CreatedAt
                        });
                    }
                }

                var totalCount = friends.Count;
                var pagedFriends = friends
                    .Skip((request.PageNumber - 1) * request.PageSize)
                    .Take(request.PageSize)
                    .ToList();

                var pagedResult = new PagedResult<FriendDto>(
                    pagedFriends,
                    request.PageNumber,
                    request.PageSize,
                    totalCount);

                return Result.Success(pagedResult);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to get friends for user {UserId}", userId);
                return Result.Failure<PagedResult<FriendDto>>("QUERY_FAILED", ex.Message);
            }
        }
    }
}

