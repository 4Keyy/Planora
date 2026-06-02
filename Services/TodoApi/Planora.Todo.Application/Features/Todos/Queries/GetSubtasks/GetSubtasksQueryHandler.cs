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
        private readonly IUserTodoViewPreferenceRepository _viewerPreferenceRepository;

        public GetSubtasksQueryHandler(
            ITodoRepository repository,
            ICurrentUserContext currentUserContext,
            IMapper mapper,
            ILogger<GetSubtasksQueryHandler> logger,
            IFriendshipService friendshipService,
            ICategoryGrpcClient categoryGrpcClient,
            IUserTodoViewPreferenceRepository viewerPreferenceRepository)
        {
            _repository = repository;
            _currentUserContext = currentUserContext;
            _mapper = mapper;
            _logger = logger;
            _friendshipService = friendshipService;
            _categoryGrpcClient = categoryGrpcClient;
            _viewerPreferenceRepository = viewerPreferenceRepository;
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

            // Per-viewer completion: a friend can mark a subtask done for themselves (the owner's
            // status is unchanged), exactly like top-level shared tasks.
            var viewerCompletedIds = new HashSet<Guid>();
            if (!isOwner)
            {
                var prefs = await _viewerPreferenceRepository.GetByViewerIdForTodosAsync(
                    userId, subtasks.Select(s => s.Id).ToList(), cancellationToken);
                foreach (var (todoId, pref) in prefs)
                {
                    if (pref.CompletedByViewer) viewerCompletedIds.Add(todoId);
                }
            }

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

            var dtos = subtasks.Select(s =>
            {
                var dto = _mapper.Map<TodoItemDto>(s) with
                {
                    CategoryName = categoryInfo?.Name,
                    CategoryColor = categoryInfo?.Color,
                    CategoryIcon = categoryInfo?.Icon,
                    WorkerCount = s.Workers.Count,
                    WorkerUserIds = s.Workers.Select(w => w.UserId).ToList(),
                    IsWorking = s.UserId != userId && s.Workers.Any(w => w.UserId == userId),
                    IsCompletedByViewer = isOwner ? null : viewerCompletedIds.Contains(s.Id),
                };
                return dto;
            }).ToList();

            return Result<IReadOnlyList<TodoItemDto>>.Success(dtos);
        }
    }
}
