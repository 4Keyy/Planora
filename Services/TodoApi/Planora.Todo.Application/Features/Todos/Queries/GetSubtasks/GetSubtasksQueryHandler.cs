using Planora.BuildingBlocks.Application.Context;
using Planora.BuildingBlocks.Domain;
using Planora.BuildingBlocks.Domain.Exceptions;
using Planora.Todo.Application.DTOs;
using Planora.Todo.Application.Interfaces;
using Planora.Todo.Application.Services;
using Planora.Todo.Domain.Repositories;

namespace Planora.Todo.Application.Features.Todos.Queries.GetSubtasks
{
    public sealed class GetSubtasksQueryHandler : IQueryHandler<GetSubtasksQuery, Result<IReadOnlyList<TodoItemDto>>>
    {
        private readonly ITodoRepository _repository;
        private readonly ICurrentUserContext _currentUserContext;
        private readonly IMapper _mapper;
        private readonly ILogger<GetSubtasksQueryHandler> _logger;
        private readonly IFriendshipService _friendshipService;
        private readonly ICategoryGrpcClient _categoryGrpcClient;
        private readonly IUserProfileService _userProfileService;

        public GetSubtasksQueryHandler(
            ITodoRepository repository,
            ICurrentUserContext currentUserContext,
            IMapper mapper,
            ILogger<GetSubtasksQueryHandler> logger,
            IFriendshipService friendshipService,
            ICategoryGrpcClient categoryGrpcClient,
            IUserProfileService userProfileService)
        {
            _repository = repository;
            _currentUserContext = currentUserContext;
            _mapper = mapper;
            _logger = logger;
            _friendshipService = friendshipService;
            _categoryGrpcClient = categoryGrpcClient;
            _userProfileService = userProfileService;
        }

        public async Task<Result<IReadOnlyList<TodoItemDto>>> Handle(
            GetSubtasksQuery request,
            CancellationToken cancellationToken)
        {
            var userId = _currentUserContext.UserId;
            if (userId == Guid.Empty)
                throw new UnauthorizedAccessException("User context is not available");

            var parent = await _repository.GetByIdWithIncludesAsync(request.ParentTodoId, cancellationToken)
                ?? throw new EntityNotFoundException("TodoItem", request.ParentTodoId);

            // Subtasks belong to top-level tasks only.
            if (parent.IsSubtask)
                throw new EntityNotFoundException("TodoItem", request.ParentTodoId);

            // Access mirrors GetTodoById: owner, or a friend for a shared/public parent.
            var isOwner = parent.UserId == userId;
            var hasAccess = isOwner;
            if (!isOwner && (parent.IsPublic || parent.SharedWith.Any(s => s.SharedWithUserId == userId)))
            {
                hasAccess = await _friendshipService.AreFriendsAsync(userId, parent.UserId, cancellationToken);
            }
            if (!hasAccess)
                throw new ForbiddenException("You do not have access to this task");

            var subtasks = await _repository.GetSubtasksAsync(request.ParentTodoId, cancellationToken);
            if (subtasks.Count == 0)
                return Result<IReadOnlyList<TodoItemDto>>.Success(Array.Empty<TodoItemDto>());

            // Subtask completion is GLOBAL: anyone with access marks it done for everyone, so the
            // status on the entity is the single source of truth (no per-viewer state).

            // All subtasks share the parent's (owner's) category — fetch it once.
            CategoryInfo? categoryInfo = null;
            if (parent.CategoryId.HasValue)
            {
                try
                {
                    categoryInfo = await _categoryGrpcClient.GetCategoryInfoAsync(
                        parent.CategoryId.Value, parent.UserId, cancellationToken);
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex,
                        "Could not enrich subtasks of {ParentId} with category {CategoryId}",
                        parent.Id, parent.CategoryId.Value);
                }
            }

            // Resolve every author AND every worker's live identity (name + avatar) in ONE Auth
            // batch call — both feed the branch card, so batching them keeps it a single round-trip.
            // Failure-tolerant: a lookup failure just leaves the labels empty.
            var profileIds = subtasks.Select(s => s.UserId)
                .Concat(subtasks.SelectMany(s => s.Workers.Select(w => w.UserId)))
                .Distinct();
            var profiles = await _userProfileService.GetProfilesAsync(profileIds, cancellationToken);

            var dtos = subtasks.Select(s =>
            {
                profiles.TryGetValue(s.UserId, out var author);
                // "In work" is GLOBAL and the same for every viewer: anyone who took the subtask into
                // work is listed here (oldest join first, for a stable avatar order), so the branch
                // shows WHO is working rather than an anonymous count. The viewer's own membership
                // (IsWorking) only drives their personal take/leave toggle.
                var workers = s.Workers
                    .OrderBy(w => w.JoinedAt)
                    .Select(w =>
                    {
                        profiles.TryGetValue(w.UserId, out var wp);
                        return new TodoWorkerDto
                        {
                            UserId = w.UserId,
                            Name = string.IsNullOrWhiteSpace(wp?.DisplayName) ? null : wp.DisplayName,
                            AvatarUrl = wp?.AvatarUrl,
                        };
                    })
                    .ToList();

                var dto = _mapper.Map<TodoItemDto>(s) with
                {
                    CategoryName = categoryInfo?.Name,
                    CategoryColor = categoryInfo?.Color,
                    CategoryIcon = categoryInfo?.Icon,
                    WorkerCount = s.Workers.Count,
                    WorkerUserIds = s.Workers.Select(w => w.UserId).ToList(),
                    Workers = workers,
                    // Subtask in-work is per-user and counted for everyone (owner included), so the
                    // viewer "is working" iff they hold a worker row — no owner exclusion here.
                    IsWorking = s.Workers.Any(w => w.UserId == userId),
                    // Completion is global — reflected in Status; no per-viewer flag for subtasks.
                    IsCompletedByViewer = null,
                    AuthorName = string.IsNullOrWhiteSpace(author?.DisplayName) ? null : author.DisplayName,
                    AuthorAvatarUrl = author?.AvatarUrl,
                };
                return dto;
            }).ToList();

            return Result<IReadOnlyList<TodoItemDto>>.Success(dtos);
        }
    }
}
