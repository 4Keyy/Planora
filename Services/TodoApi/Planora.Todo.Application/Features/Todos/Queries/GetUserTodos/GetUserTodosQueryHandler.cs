using Planora.BuildingBlocks.Application.Pagination;
using Planora.BuildingBlocks.Infrastructure.Context;
using Planora.Todo.Application.DTOs;
using Planora.Todo.Application.Features.Todos;
using Planora.Todo.Application.Interfaces;
using Planora.Todo.Application.Services;
using Planora.Todo.Domain.Enums;
using Planora.Todo.Domain.Repositories;
using Planora.Todo.Domain.ValueObjects;
using System.Linq;
using System.Linq.Expressions;

namespace Planora.Todo.Application.Features.Todos.Queries.GetUserTodos
{
    public sealed class GetUserTodosQueryHandler : IRequestHandler<GetUserTodosQuery, PagedResult<TodoItemDto>>
    {
        private readonly ITodoRepository _repository;
        private readonly IMapper _mapper;
        private readonly ILogger<GetUserTodosQueryHandler> _logger;
        private readonly ICurrentUserContext _currentUserContext;
        private readonly ICategoryGrpcClient _categoryGrpcClient;
        private readonly IFriendshipService _friendshipService;
        private readonly IUserTodoViewPreferenceRepository _viewerPreferenceRepository;

        public GetUserTodosQueryHandler(
            ITodoRepository repository,
            IMapper mapper,
            ILogger<GetUserTodosQueryHandler> logger,
            ICurrentUserContext currentUserContext,
            ICategoryGrpcClient categoryGrpcClient,
            IFriendshipService friendshipService,
            IUserTodoViewPreferenceRepository viewerPreferenceRepository)
        {
            _repository = repository;
            _mapper = mapper;
            _logger = logger;
            _currentUserContext = currentUserContext;
            _categoryGrpcClient = categoryGrpcClient;
            _friendshipService = friendshipService;
            _viewerPreferenceRepository = viewerPreferenceRepository;
        }

        public async Task<PagedResult<TodoItemDto>> Handle(
            GetUserTodosQuery request,
            CancellationToken cancellationToken)
        {
            var userId = request.UserId ?? _currentUserContext.UserId;
            if (userId == Guid.Empty)
                throw new UnauthorizedAccessException("User context is not available");

            // Parse statuses beforehand to avoid issues in the predicate
            List<TodoStatus>? requestedStatuses = null;
            if (!string.IsNullOrEmpty(request.Status))
            {
                requestedStatuses = request.Status
                    .Split(',', StringSplitOptions.RemoveEmptyEntries)
                    .Select(s => TodoStatusExtensions.FromString(s.Trim()))
                    .Where(s => s.HasValue)
                    .Select(s => s!.Value)
                    .ToList();
            }

            var friendIds = (await _friendshipService.GetFriendIdsAsync(userId, cancellationToken)).ToList();
            _logger.LogInformation("Retrieved {Count} friends for user {UserId}", friendIds.Count, userId);

            var viewerCategoryTodoIds = request.CategoryId.HasValue
                ? await _viewerPreferenceRepository.GetTodoIdsByViewerCategoryAsync(
                    userId,
                    request.CategoryId.Value,
                    cancellationToken)
                : new List<Guid>();

            // Pre-load IDs of tasks that this viewer personally marked as completed
            var viewerCompletedIds = await _viewerPreferenceRepository.GetCompletedTodoIdsByViewerAsync(
                userId, cancellationToken);

            // Build predicate: own todos OR friend-visible todos.
            // Viewer category filters can be pushed into the shared-task branch using
            // the viewer preference IDs, so the database can count/page before enrichment.
            var predicate = BuildPredicateWithFriends(
                userId,
                friendIds,
                request,
                requestedStatuses,
                viewerCategoryTodoIds,
                viewerCompletedIds);

            var sortCompletedByCompletionTime =
                request.IsCompleted == true ||
                (requestedStatuses is { Count: > 0 } && requestedStatuses.All(s => s == TodoStatus.Done));

            var (paginatedItems, totalCount) = await _repository.GetPagedWithIncludesAsync(
                predicate,
                request.PageNumber,
                request.PageSize,
                sortCompletedByCompletionTime,
                cancellationToken);

            var pageTodoIds = paginatedItems.Select(item => item.Id).ToList();
            var viewerPreferences = await _viewerPreferenceRepository.GetByViewerIdForTodosAsync(
                userId,
                pageTodoIds,
                cancellationToken);

            var dtos = new List<TodoItemDto>(paginatedItems.Count);

            _logger.LogInformation("Enriching {Count} todos with category data via gRPC", paginatedItems.Count);

            // Gather unique effective category IDs (viewer's own category) and fetch all at once
            var categoryIds = paginatedItems
                .Select(i =>
                {
                    viewerPreferences.TryGetValue(i.Id, out var preference);
                    return TodoViewerStateResolver.GetEffectiveCategoryId(i, userId, preference);
                })
                .Where(id => id.HasValue)
                .Select(id => id!.Value)
                .Distinct()
                .ToList();

            var categoryResults = await Task.WhenAll(categoryIds.Select(async categoryId =>
            {
                try
                {
                    var info = await _categoryGrpcClient.GetCategoryInfoAsync(categoryId, userId, cancellationToken);
                    _logger.LogInformation(
                        "Fetched category {Id}: Name={Name}, Color={Color}, Icon={Icon}",
                        categoryId,
                        info?.Name,
                        info?.Color,
                        info?.Icon);
                    return (categoryId, info);
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Failed to fetch category {Id}", categoryId);
                    return (categoryId, info: (CategoryInfo?)null);
                }
            }));

            var categoryCache = categoryResults.ToDictionary(x => x.categoryId, x => x.info);

            // Fetch author categories for non-owner tasks so the viewer can see the author's category as a hint
            var authorCategoryFetches = paginatedItems
                .Where(i => i.UserId != userId && i.CategoryId.HasValue)
                .Select(i => (categoryId: i.CategoryId!.Value, ownerUserId: i.UserId))
                .DistinctBy(x => x.categoryId)
                .ToList();

            var authorCategoryResults = await Task.WhenAll(authorCategoryFetches.Select(async fetch =>
            {
                try
                {
                    var info = await _categoryGrpcClient.GetCategoryInfoAsync(fetch.categoryId, fetch.ownerUserId, cancellationToken);
                    return (fetch.categoryId, info);
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Failed to fetch author category {Id}", fetch.categoryId);
                    return (fetch.categoryId, info: (CategoryInfo?)null);
                }
            }));

            var authorCategoryCache = authorCategoryResults.ToDictionary(x => x.categoryId, x => x.info);

            foreach (var item in paginatedItems)
            {
                viewerPreferences.TryGetValue(item.Id, out var preference);
                var effectiveHidden = TodoViewerStateResolver.GetEffectiveHidden(item, userId, preference);
                var effectiveCategoryId = TodoViewerStateResolver.GetEffectiveCategoryId(item, userId, preference);
                var isViewerOwner = item.UserId == userId;
                var completedByViewer = !isViewerOwner && (preference?.CompletedByViewer == true);

                if (effectiveHidden)
                {
                    // Return minimal DTO for hidden tasks — no sensitive data
                    CategoryInfo? hiddenCat = null;
                    if (effectiveCategoryId.HasValue)
                        categoryCache.TryGetValue(effectiveCategoryId.Value, out hiddenCat);

                    if (HiddenTodoDtoFactory.ShouldMask(item, userId, effectiveHidden))
                    {
                        dtos.Add(HiddenTodoDtoFactory.CreateMasked(item, userId, effectiveCategoryId, hiddenCat));
                        continue;
                    }

                    dtos.Add(new TodoItemDto
                    {
                        Id = item.Id,
                        UserId = item.UserId,
                        Title = item.Title,
                        Hidden = true,
                        Status = item.Status.Display(),
                        Priority = item.Priority.ToString(),
                        IsPublic = item.IsPublic,
                        IsCompleted = item.IsCompleted,
                        Tags = Array.Empty<string>(),
                        CreatedAt = item.CreatedAt,
                        SharedWithUserIds = Array.Empty<Guid>(),
                        HasSharedAudience = TodoViewerStateResolver.HasSharedAudience(item),
                        IsVisuallyUrgent = TodoViewerStateResolver.IsVisuallyUrgent(item),
                        CategoryId = effectiveCategoryId,
                        CategoryName = hiddenCat?.Name,
                        CategoryColor = hiddenCat?.Color,
                        CategoryIcon = hiddenCat?.Icon,
                        WorkerCount = item.Workers.Count,
                        WorkerUserIds = item.Workers.Select(w => w.UserId).ToList(),
                        RequiredWorkers = item.RequiredWorkers,
                        IsWorking = item.UserId != userId && item.Workers.Any(w => w.UserId == userId),
                    });
                    continue;
                }

                var dto = _mapper.Map<TodoItemDto>(item) with
                {
                    Hidden = effectiveHidden,
                    CategoryId = effectiveCategoryId,
                    CategoryName = null,
                    CategoryColor = null,
                    CategoryIcon = null,
                    WorkerCount = item.Workers.Count,
                    WorkerUserIds = item.Workers.Select(w => w.UserId).ToList(),
                    RequiredWorkers = item.RequiredWorkers,
                    IsWorking = !isViewerOwner && item.Workers.Any(w => w.UserId == userId),
                    IsCompletedByViewer = !isViewerOwner ? completedByViewer : null,
                    Status = completedByViewer ? "Done" : item.Status.Display(),
                    IsCompleted = completedByViewer || item.IsCompleted,
                };

                if (effectiveCategoryId.HasValue && categoryCache.TryGetValue(effectiveCategoryId.Value, out var cat))
                {
                    dto = dto with
                    {
                        CategoryName  = cat?.Name,
                        CategoryColor = cat?.Color,
                        CategoryIcon  = cat?.Icon,
                    };
                }

                if (!isViewerOwner && item.CategoryId.HasValue &&
                    authorCategoryCache.TryGetValue(item.CategoryId.Value, out var authorCat))
                {
                    dto = dto with
                    {
                        AuthorCategoryName  = authorCat?.Name,
                        AuthorCategoryColor = authorCat?.Color,
                        AuthorCategoryIcon  = authorCat?.Icon,
                    };
                }

                dtos.Add(dto);
            }

            _logger.LogInformation("Retrieved {Count} todos for user {UserId}", paginatedItems.Count, userId);

            return new PagedResult<TodoItemDto>(dtos, request.PageNumber, request.PageSize, totalCount);
        }

        private static Expression<Func<TodoItem, bool>> BuildPredicateWithFriends(
            Guid userId,
            List<Guid> friendIds,
            GetUserTodosQuery request,
            List<TodoStatus>? requestedStatuses,
            List<Guid> viewerCategoryTodoIds,
            List<Guid> viewerCompletedIds)
        {
            var hasCategoryFilter = request.CategoryId.HasValue;
            var categoryId = request.CategoryId.GetValueOrDefault();

            // Determine if the query is effectively asking for active or completed tasks
            // either via explicit isCompleted flag or via status list.
            var isAskingForCompleted = request.IsCompleted == true || 
                (requestedStatuses != null && requestedStatuses.Count > 0 && requestedStatuses.All(s => s == TodoStatus.Done));
            
            var isAskingForActive = request.IsCompleted == false || 
                (requestedStatuses != null && requestedStatuses.Count > 0 && requestedStatuses.All(s => s != TodoStatus.Done));

            return x => !x.IsDeleted &&
                       (requestedStatuses == null || requestedStatuses.Contains(x.Status)) &&
                       
                       // Filter by viewer completion state:
                       // 1. If asking for completed: show globally Done OR viewer-completed
                       // 2. If asking for active: show globally not-Done AND not viewer-completed
                       // 3. Otherwise (mixed/null): show all
                       (isAskingForCompleted
                            ? (x.Status == TodoStatus.Done || (x.UserId != userId && viewerCompletedIds.Contains(x.Id)))
                            : isAskingForActive
                                ? (x.Status != TodoStatus.Done && !(x.UserId != userId && viewerCompletedIds.Contains(x.Id)))
                                : true) &&

                       (
                           // Own todos use the owner's category directly.
                           (x.UserId == userId &&
                            (!hasCategoryFilter || x.CategoryId == categoryId)) ||
                           // Friend tasks are visible when they are public or directly shared with the viewer.
                           (friendIds.Contains(x.UserId) &&
                            (x.IsPublic || x.SharedWith.Any(s => s.SharedWithUserId == userId)) &&
                            (!hasCategoryFilter || viewerCategoryTodoIds.Contains(x.Id)))
                       );
        }

    }
}
