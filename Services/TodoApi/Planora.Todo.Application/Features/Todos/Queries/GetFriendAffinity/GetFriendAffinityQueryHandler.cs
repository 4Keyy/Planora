using System.Linq.Expressions;
using Planora.BuildingBlocks.Application.Context;
using Planora.Todo.Application.Common;
using Planora.Todo.Application.DTOs;
using Planora.Todo.Application.Services;
using Planora.Todo.Domain.Repositories;

namespace Planora.Todo.Application.Features.Todos.Queries.GetFriendAffinity
{
    public sealed class GetFriendAffinityQueryHandler
        : IRequestHandler<GetFriendAffinityQuery, IReadOnlyList<FriendAffinityDto>>
    {
        private readonly ITodoRepository _repository;
        private readonly IFriendshipService _friendshipService;
        private readonly ICurrentUserContext _currentUserContext;
        private readonly TimeProvider _timeProvider;
        private readonly ILogger<GetFriendAffinityQueryHandler> _logger;

        public GetFriendAffinityQueryHandler(
            ITodoRepository repository,
            IFriendshipService friendshipService,
            ICurrentUserContext currentUserContext,
            TimeProvider timeProvider,
            ILogger<GetFriendAffinityQueryHandler> logger)
        {
            _repository = repository;
            _friendshipService = friendshipService;
            _currentUserContext = currentUserContext;
            _timeProvider = timeProvider;
            _logger = logger;
        }

        public async Task<IReadOnlyList<FriendAffinityDto>> Handle(
            GetFriendAffinityQuery request, CancellationToken cancellationToken)
        {
            var userId = _currentUserContext.UserId;
            if (userId == Guid.Empty)
                throw new UnauthorizedAccessException("User context is not available");

            var friendIds = AllFriendsSnapshotAudience
                .Current(await _friendshipService.GetFriendshipsAsync(userId, cancellationToken))
                .ToList();
            if (friendIds.Count == 0)
                return [];

            var utcNow = _timeProvider.GetUtcNow().UtcDateTime;
            var keys = await _repository.GetFriendShareKeysAsync(
                BuildPredicate(userId, friendIds), userId, friendIds, cancellationToken);

            var affinity = keys
                .GroupBy(key => key.OwnerId == userId ? key.SharedWithUserId : key.OwnerId)
                .Select(group => new FriendAffinityDto
                {
                    FriendId = group.Key,
                    // Decimal arithmetic keeps midpoint values such as 0.375 from rounding down
                    // because of binary floating-point error.
                    Score = (double)Math.Round(group.Sum(key =>
                        1m / (1m + (decimal)Math.Max(0, (utcNow - key.ActivityAt).TotalDays) / 30m)),
                        2, MidpointRounding.AwayFromZero),
                    SharedByMe = group.Count(key => key.OwnerId == userId),
                    SharedWithMe = group.Count(key => key.OwnerId != userId),
                })
                // Tie-break on the score the client receives, after rounding the complete sum.
                .OrderByDescending(item => item.Score)
                .ThenByDescending(item => item.SharedByMe + item.SharedWithMe)
                .ThenBy(item => item.FriendId)
                .ToList();

            _logger.LogInformation(
                "Calculated affinity from {ShareCount} directed shares across {FriendCount} friends for user {UserId}",
                keys.Count, affinity.Count, userId);

            return affinity;
        }

        private static Expression<Func<TodoItem, bool>> BuildPredicate(Guid userId, List<Guid> friendIds) =>
            todo => !todo.IsDeleted && todo.ParentTodoId == null && !todo.IsPublic &&
                (todo.UserId == userId || friendIds.Contains(todo.UserId));
    }
}
