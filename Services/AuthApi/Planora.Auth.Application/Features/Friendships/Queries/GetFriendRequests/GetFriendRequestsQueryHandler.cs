using Planora.BuildingBlocks.Application.Models;

namespace Planora.Auth.Application.Features.Friendships.Queries.GetFriendRequests
{
    public sealed class GetFriendRequestsQueryHandler : IRequestHandler<GetFriendRequestsQuery, Result<IReadOnlyList<FriendRequestDto>>>
    {
        private readonly IFriendshipRepository _friendshipRepository;
        private readonly IUserRepository _userRepository;
        private readonly ICurrentUserService _currentUserService;
        private readonly ILogger<GetFriendRequestsQueryHandler> _logger;

        public GetFriendRequestsQueryHandler(
            IFriendshipRepository friendshipRepository,
            IUserRepository userRepository,
            ICurrentUserService currentUserService,
            ILogger<GetFriendRequestsQueryHandler> logger)
        {
            _friendshipRepository = friendshipRepository;
            _userRepository = userRepository;
            _currentUserService = currentUserService;
            _logger = logger;
        }

        public async Task<Result<IReadOnlyList<FriendRequestDto>>> Handle(GetFriendRequestsQuery request, CancellationToken cancellationToken)
        {
            if (!_currentUserService.UserId.HasValue)
                return Result.Failure<IReadOnlyList<FriendRequestDto>>("AUTH_REQUIRED", "User context is not available");

            var userId = _currentUserService.UserId.Value;

            try
            {
                var friendships = await _friendshipRepository.GetFriendshipsForUserAsync(
                    userId,
                    Domain.Enums.FriendshipStatus.Pending,
                    cancellationToken);

                var requests = new List<FriendRequestDto>();

                foreach (var friendship in friendships)
                {
                    Guid otherUserId;
                    if (request.Incoming && friendship.AddresseeId == userId)
                    {
                        otherUserId = friendship.RequesterId;
                    }
                    else if (!request.Incoming && friendship.RequesterId == userId)
                    {
                        otherUserId = friendship.AddresseeId;
                    }
                    else
                    {
                        continue;
                    }

                    var user = await _userRepository.GetByIdAsync(otherUserId, cancellationToken);
                    if (user != null)
                    {
                        requests.Add(new FriendRequestDto
                        {
                            FriendshipId = friendship.Id,
                            UserId = user.Id,
                            Email = user.Email.Value,
                            FirstName = user.FirstName,
                            LastName = user.LastName,
                            ProfilePictureUrl = user.ProfilePictureUrl,
                            RequestedAt = friendship.RequestedAt ?? friendship.CreatedAt,
                            Status = friendship.Status.ToString()
                        });
                    }
                }

                return Result.Success((IReadOnlyList<FriendRequestDto>)requests);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to get friend requests for user {UserId}", userId);
                return Result.Failure<IReadOnlyList<FriendRequestDto>>("QUERY_FAILED", ex.Message);
            }
        }
    }
}

