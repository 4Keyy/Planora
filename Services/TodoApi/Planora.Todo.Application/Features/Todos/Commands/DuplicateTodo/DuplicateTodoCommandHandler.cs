using Planora.BuildingBlocks.Application.Context;
using Planora.BuildingBlocks.Application.Messaging.Events;
using Planora.BuildingBlocks.Application.Outbox;
using Planora.BuildingBlocks.Domain;
using Planora.BuildingBlocks.Domain.Exceptions;
using Planora.Todo.Application.Common;
using Planora.Todo.Application.DTOs;
using Planora.Todo.Application.Interfaces;
using Planora.Todo.Application.Services;
using Planora.Todo.Domain.Entities;
using Planora.Todo.Domain.Repositories;

namespace Planora.Todo.Application.Features.Todos.Commands.DuplicateTodo
{
    public sealed class DuplicateTodoCommandHandler : IRequestHandler<DuplicateTodoCommand, Result<TodoItemDto>>
    {
        private readonly ITodoRepository _repository;
        private readonly IUnitOfWork _unitOfWork;
        private readonly IMapper _mapper;
        private readonly ILogger<DuplicateTodoCommandHandler> _logger;
        private readonly ICurrentUserContext _currentUserContext;
        private readonly ICategoryGrpcClient _categoryGrpcClient;
        private readonly IFriendshipService _friendshipService;
        private readonly IOutboxRepository _outboxRepository;

        public DuplicateTodoCommandHandler(
            ITodoRepository repository,
            IUnitOfWork unitOfWork,
            IMapper mapper,
            ILogger<DuplicateTodoCommandHandler> logger,
            ICurrentUserContext currentUserContext,
            ICategoryGrpcClient categoryGrpcClient,
            IFriendshipService friendshipService,
            IOutboxRepository outboxRepository)
        {
            _repository = repository;
            _unitOfWork = unitOfWork;
            _mapper = mapper;
            _logger = logger;
            _currentUserContext = currentUserContext;
            _categoryGrpcClient = categoryGrpcClient;
            _friendshipService = friendshipService;
            _outboxRepository = outboxRepository;
        }

        public async Task<Result<TodoItemDto>> Handle(
            DuplicateTodoCommand request,
            CancellationToken cancellationToken)
        {
            var userId = _currentUserContext.UserId;
            if (userId == Guid.Empty)
                throw new UnauthorizedAccessException("User context is not available");

            var source = await _repository.GetByIdWithIncludesAsync(request.SourceTodoId, cancellationToken)
                ?? throw new EntityNotFoundException("TodoItem", request.SourceTodoId);

            // Subtasks are part of a parent's branch, not standalone tasks — they are duplicated only
            // implicitly (and here, never): a subtask has no independent existence to copy into a list.
            if (source.IsSubtask)
                throw new EntityNotFoundException("TodoItem", request.SourceTodoId);

            // Any participant may fork a task they can see into their own list — the copy is created
            // under the duplicator's account (TodoItem.Create(userId, …) below), so the author keeps
            // the original untouched. This is the non-owner's path on a completed shared task:
            // returning it to work is author-only, but duplicating it is open to every participant.
            // Access mirrors the view rule (owner, or a friend who can see a public/shared task).
            var isOwner = source.UserId == userId;
            if (!isOwner)
            {
                var canSee = await TodoAccessPolicy.CanAccessAsync(source, userId, _friendshipService, cancellationToken);
                if (!canSee)
                    throw new ForbiddenException("You can only duplicate tasks you have access to");
            }

            // Category is the owner's own; re-validate it still exists. If it was deleted, drop it
            // rather than failing the duplicate (the copy simply starts uncategorised).
            Guid? categoryId = source.CategoryId;
            CategoryInfo? categoryInfo = null;
            if (categoryId.HasValue)
            {
                categoryInfo = await _categoryGrpcClient.GetCategoryInfoAsync(categoryId.Value, userId, cancellationToken);
                if (categoryInfo is null) categoryId = null;
            }

            // All friends uses the duplicator's current circle. Direct shares are copied after
            // re-validating friendship so removed friends are not re-granted access on the copy.
            var sharedWith = source.SharedWith
                .Select(s => s.SharedWithUserId)
                .Where(id => id != Guid.Empty && id != userId)
                .Distinct()
                .ToList();
            DateTime? snapshotAt = null;
            if (source.IsPublic)
            {
                var friendships = await _friendshipService.GetFriendshipsAsync(userId, cancellationToken);
                sharedWith = AllFriendsSnapshotAudience.Current(friendships).ToList();
                snapshotAt = DateTime.UtcNow;
            }
            else if (sharedWith.Count > 0)
            {
                var friendIds = AllFriendsSnapshotAudience.Current(await _friendshipService.GetFriendshipsAsync(userId, cancellationToken));
                var allowed = new HashSet<Guid>(friendIds);
                sharedWith = sharedWith.Where(allowed.Contains).ToList();
            }

            // Fresh task: copies the "what" (title/description/priority/category/visibility/audience/
            // required workers) but NOT the dates — the copy starts with a clean schedule and as an
            // active (not completed) task.
            var copy = TodoItem.Create(
                userId,
                source.Title,
                source.Description,
                categoryId,
                dueDate: null,
                expectedDate: null,
                source.Priority,
                source.IsPublic,
                sharedWith,
                source.IsPublic ? null : source.RequiredWorkers,
                allFriendsSnapshotAt: snapshotAt);

            // Tags are part of the "what" — carry them over.
            foreach (var tag in source.Tags)
                copy.AddTag(tag.Name, userId);

            await _repository.AddAsync(copy, cancellationToken);

            var authorName = _currentUserContext.Name ?? _currentUserContext.Email ?? userId.ToString();

            // Same creation fact a normal create emits: Collaboration materialises the new branch's
            // "created the task" system comment + the genesis (description) from it (INV-COMM-3).
            // The source branch (comments/subtasks) is intentionally NOT copied.
            await _outboxRepository.EnqueueIntegrationEventAsync(
                new TaskCreatedIntegrationEvent(copy.Id, userId, authorName, source.Description),
                cancellationToken);

            // Live feed sync: the copy appears on every viewer's list/dashboard, exactly like a
            // normal create. The audience is computed from the copy's own visibility.
            var audience = await RealtimeAudience.ResolveAsync(
                copy, _friendshipService, cancellationToken, _logger);
            await _outboxRepository.EnqueueIntegrationEventAsync(
                new RealtimeSyncIntegrationEvent(
                    RealtimeSyncAction.TaskCreated, copy.Id, userId, audienceUserIds: audience),
                cancellationToken);

            await _unitOfWork.SaveChangesAsync(cancellationToken);

            _logger.LogInformation(
                "Todo item {SourceId} duplicated as {CopyId} by user {UserId}",
                source.Id, copy.Id, userId);

            var dto = _mapper.Map<TodoItemDto>(copy);
            if (categoryInfo is not null)
            {
                dto = dto with
                {
                    CategoryName = categoryInfo.Name,
                    CategoryColor = categoryInfo.Color,
                    CategoryIcon = categoryInfo.Icon,
                };
            }

            return Result<TodoItemDto>.Success(dto);
        }
    }
}
