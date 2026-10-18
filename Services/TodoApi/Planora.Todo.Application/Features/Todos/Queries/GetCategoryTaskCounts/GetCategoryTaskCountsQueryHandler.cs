using System.Linq.Expressions;
using Planora.BuildingBlocks.Application.Context;
using Planora.Todo.Application.Common;
using Planora.Todo.Application.DTOs;
using Planora.Todo.Application.Services;
using Planora.Todo.Domain.Enums;
using Planora.Todo.Domain.Repositories;

namespace Planora.Todo.Application.Features.Todos.Queries.GetCategoryTaskCounts
{
    /// <summary>
    /// Counts what the active task list would show for each category, without listing it.
    ///
    /// A category's count is exactly the <c>totalCount</c> of
    /// <c>GET /todos?categoryId={id}&amp;isCompleted=false</c>: the same access rule
    /// (<see cref="TodoAccessPolicy.VisibleTo"/>), top-level tasks only, nothing globally done and
    /// nothing the caller completed for themselves. A task is counted under the category the CALLER
    /// sees it in — the owner's category for their own task, the caller's personal category for a
    /// friend's shared one — so a shared task the caller never filed counts nowhere.
    ///
    /// One narrow projection of the matching rows replaces one list request per category; the
    /// grouping happens here because a shared task's category lives in the caller's preferences,
    /// not on the task row.
    /// </summary>
    public sealed class GetCategoryTaskCountsQueryHandler
        : IRequestHandler<GetCategoryTaskCountsQuery, IReadOnlyList<CategoryTaskCountDto>>
    {
        private readonly ITodoRepository _repository;
        private readonly IUserTodoViewPreferenceRepository _viewerPreferenceRepository;
        private readonly IFriendshipService _friendshipService;
        private readonly ICurrentUserContext _currentUserContext;
        private readonly ILogger<GetCategoryTaskCountsQueryHandler> _logger;

        public GetCategoryTaskCountsQueryHandler(
            ITodoRepository repository,
            IUserTodoViewPreferenceRepository viewerPreferenceRepository,
            IFriendshipService friendshipService,
            ICurrentUserContext currentUserContext,
            ILogger<GetCategoryTaskCountsQueryHandler> logger)
        {
            _repository = repository;
            _viewerPreferenceRepository = viewerPreferenceRepository;
            _friendshipService = friendshipService;
            _currentUserContext = currentUserContext;
            _logger = logger;
        }

        public async Task<IReadOnlyList<CategoryTaskCountDto>> Handle(
            GetCategoryTaskCountsQuery request,
            CancellationToken cancellationToken)
        {
            var userId = request.UserId ?? _currentUserContext.UserId;
            if (userId == Guid.Empty)
                throw new UnauthorizedAccessException("User context is not available");

            var friendIds = AllFriendsSnapshotAudience
                .Current(await _friendshipService.GetFriendshipsAsync(userId, cancellationToken))
                .ToList();
            var viewerCategories = await _viewerPreferenceRepository.GetViewerCategoryAssignmentsAsync(userId, cancellationToken);
            var viewerCompletedIds = await _viewerPreferenceRepository.GetCompletedTodoIdsByViewerAsync(userId, cancellationToken);

            var keys = await _repository.GetCategoryKeysAsync(
                BuildPredicate(userId, friendIds, viewerCategories.Keys.ToList(), viewerCompletedIds),
                cancellationToken);

            var counts = new Dictionary<Guid, int>();
            foreach (var key in keys)
            {
                // Mirrors TodoViewerStateResolver.GetEffectiveCategoryId for the rows the predicate admits.
                Guid? categoryId = key.UserId == userId
                    ? key.CategoryId
                    : viewerCategories.TryGetValue(key.Id, out var viewerCategory) ? viewerCategory : null;
                if (categoryId is not { } id || id == Guid.Empty)
                    continue;
                counts[id] = counts.GetValueOrDefault(id) + 1;
            }

            _logger.LogInformation(
                "Counted {TaskCount} open tasks across {CategoryCount} categories for user {UserId}",
                keys.Count, counts.Count, userId);

            return counts
                .Select(pair => new CategoryTaskCountDto { CategoryId = pair.Key, OpenCount = pair.Value })
                .ToList();
        }

        /// <summary>The active list's predicate, narrowed to tasks that sit in some category.</summary>
        private static Expression<Func<TodoItem, bool>> BuildPredicate(
            Guid userId,
            List<Guid> friendIds,
            List<Guid> viewerCategorizedIds,
            List<Guid> viewerCompletedIds)
        {
            Expression<Func<TodoItem, bool>> open = x => !x.IsDeleted &&
                x.ParentTodoId == null &&
                x.Status != TodoStatus.Done &&
                !(x.UserId != userId && viewerCompletedIds.Contains(x.Id)) &&
                ((x.UserId == userId && x.CategoryId != null) ||
                 (x.UserId != userId && viewerCategorizedIds.Contains(x.Id)));

            return TodoAccessPolicy.And(open, TodoAccessPolicy.VisibleTo(userId, friendIds));
        }
    }
}
