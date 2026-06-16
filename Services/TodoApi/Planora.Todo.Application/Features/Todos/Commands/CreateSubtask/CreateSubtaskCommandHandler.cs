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

namespace Planora.Todo.Application.Features.Todos.Commands.CreateSubtask
{
    public sealed class CreateSubtaskCommandHandler : IRequestHandler<CreateSubtaskCommand, Result<TodoItemDto>>
    {
        private readonly ITodoRepository _repository;
        private readonly IUnitOfWork _unitOfWork;
        private readonly IMapper _mapper;
        private readonly ILogger<CreateSubtaskCommandHandler> _logger;
        private readonly ICurrentUserContext _currentUserContext;
        private readonly IFriendshipService _friendshipService;
        private readonly ICategoryGrpcClient _categoryGrpcClient;
        private readonly IOutboxRepository _outboxRepository;

        public CreateSubtaskCommandHandler(
            ITodoRepository repository,
            IUnitOfWork unitOfWork,
            IMapper mapper,
            ILogger<CreateSubtaskCommandHandler> logger,
            ICurrentUserContext currentUserContext,
            IFriendshipService friendshipService,
            ICategoryGrpcClient categoryGrpcClient,
            IOutboxRepository outboxRepository)
        {
            _repository = repository;
            _unitOfWork = unitOfWork;
            _mapper = mapper;
            _logger = logger;
            _currentUserContext = currentUserContext;
            _friendshipService = friendshipService;
            _categoryGrpcClient = categoryGrpcClient;
            _outboxRepository = outboxRepository;
        }

        public async Task<Result<TodoItemDto>> Handle(
            CreateSubtaskCommand request,
            CancellationToken cancellationToken)
        {
            var userId = _currentUserContext.UserId;
            if (userId == Guid.Empty)
                throw new UnauthorizedAccessException("User context is not available");

            // Load the parent tracked so the new child is attached in the same unit of work and
            // the parent's current category/visibility/shares can be inherited.
            var parent = await _repository.GetByIdWithIncludesTrackedAsync(request.ParentTodoId, cancellationToken)
                ?? throw new EntityNotFoundException("TodoItem", request.ParentTodoId);

            // Branch-access guard (mirrors GetSubtasks): the owner, OR a friend with access to a
            // shared/public parent, may add a subtask — collaborators contribute steps to a task
            // they participate in, not just the author. Never to another subtask (no nesting).
            var isOwner = parent.UserId == userId;
            var hasAccess = isOwner;
            if (!isOwner && (parent.IsPublic || parent.SharedWith.Any(s => s.SharedWithUserId == userId)))
            {
                hasAccess = await _friendshipService.AreFriendsAsync(userId, parent.UserId, cancellationToken);
            }
            if (!hasAccess)
                throw new ForbiddenException("You do not have access to this task");
            if (parent.IsSubtask)
                throw new ForbiddenException("A subtask cannot have its own subtasks");

            var subtask = TodoItem.CreateSubtask(
                parent,
                userId,
                request.Title,
                request.Description,
                request.Priority);

            await _repository.AddAsync(subtask, cancellationToken);

            // Subtask creation is deliberately NOT announced in the parent's branch as a system
            // comment — there is no "created a subtask" notification. (Completion still emits
            // SubtaskCompleted.) It IS pushed live, though, so anyone with the parent's branch open
            // sees the new subtask card appear without a refresh.
            await _outboxRepository.EnqueueIntegrationEventAsync(
                new RealtimeSyncIntegrationEvent(
                    RealtimeSyncAction.SubtaskChanged, subtask.Id, userId, branchTaskId: parent.Id),
                cancellationToken);

            // Notify every other participant of the parent task that a subtask was added (the author
            // of the subtask is excluded). The subtask inherits the parent's audience, so resolving
            // from the parent gives exactly the people who can see this branch.
            var actorName = _currentUserContext.Name ?? _currentUserContext.Email ?? userId.ToString();
            var audience = await RealtimeAudience.ResolveAsync(parent, _friendshipService, cancellationToken, _logger);
            await NotificationFanout.EnqueueAsync(
                _outboxRepository, audience, actorId: userId, taskId: parent.Id,
                type: NotificationType.SubtaskAdded,
                title: "New subtask",
                message: $"{actorName} added a subtask: “{NotificationFanout.TitlePreview(request.Title)}”",
                cancellationToken);

            await _unitOfWork.SaveChangesAsync(cancellationToken);

            _logger.LogInformation(
                "Subtask {SubtaskId} created under task {ParentId} by user {UserId}",
                subtask.Id, parent.Id, userId);

            // The subtask is owned by the parent owner. When the owner is the caller, their JWT
            // claims are the freshest author source; when a collaborator added it the author (the
            // owner) is resolved on the next branch reconcile (GetSubtasks), so it is left unset
            // here rather than mislabelled as the collaborator.
            var dto = _mapper.Map<TodoItemDto>(subtask);
            if (subtask.UserId == userId)
            {
                dto = dto with
                {
                    AuthorName = _currentUserContext.Name ?? _currentUserContext.Email,
                    AuthorAvatarUrl = string.IsNullOrEmpty(_currentUserContext.ProfilePictureUrl)
                        ? null
                        : _currentUserContext.ProfilePictureUrl,
                };
            }

            // Enrich with the (inherited) category so the subtask card shows the same label as the parent.
            if (subtask.CategoryId.HasValue)
            {
                try
                {
                    var categoryInfo = await _categoryGrpcClient.GetCategoryInfoAsync(
                        subtask.CategoryId.Value, userId, cancellationToken);
                    if (categoryInfo is not null)
                    {
                        dto = dto with
                        {
                            CategoryName = categoryInfo.Name,
                            CategoryColor = categoryInfo.Color,
                            CategoryIcon = categoryInfo.Icon,
                        };
                    }
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex,
                        "Could not enrich subtask {SubtaskId} with category {CategoryId}",
                        subtask.Id, subtask.CategoryId.Value);
                }
            }

            return Result<TodoItemDto>.Success(dto);
        }
    }
}
