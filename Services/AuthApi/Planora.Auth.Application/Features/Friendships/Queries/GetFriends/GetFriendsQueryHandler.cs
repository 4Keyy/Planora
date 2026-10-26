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

                // Batch-load the friend users in a single AsNoTracking query instead of one
                // tracking GetByIdAsync per friend (was N+1 — 501 queries for 500 friends).
                var users = await _userRepository.GetByIdsAsync(friendIds, cancellationToken);
                var usersById = users.ToDictionary(u => u.Id);

                var friends = new List<FriendDto>();
                foreach (var friendId in friendIds)
                {
                    if (!usersById.TryGetValue(friendId, out var friend))
                        continue;

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

                // Page with the same normalised size the result reports (at most 100): slicing by the
                // raw request size returned 200 rows under a pageSize of 100, so page 2 overlapped
                // page 1 by the result's own arithmetic. The repository returns rows in no particular
                // order, so the list is ordered first — oldest friendship first, then id — or pages
                // read at different times could repeat or skip a friend.
                var (pageNumber, pageSize) = PaginationParameters.Normalize(request.PageNumber, request.PageSize);
                var totalCount = friends.Count;
                var pagedFriends = friends
                    .OrderBy(f => f.FriendsSince)
                    .ThenBy(f => f.Id)
                    .Skip((pageNumber - 1) * pageSize)
                    .Take(pageSize)
                    .ToList();

                var pagedResult = new PagedResult<FriendDto>(
                    pagedFriends,
                    pageNumber,
                    pageSize,
                    totalCount);

                return Result.Success(pagedResult);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to get friends for user {UserId}", userId);
                return Result.Failure<PagedResult<FriendDto>>("QUERY_FAILED", "An error occurred retrieving data");
            }
        }
    }
}

