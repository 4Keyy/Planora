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

            // Owner-only (IDOR guard): you can only duplicate a task you own. A collaborator who can
            // see a shared task cannot silently fork it into their own list.
            if (source.UserId != userId)
                throw new ForbiddenException("You can only duplicate your own tasks");

            // Category is the owner's own; re-validate it still exists. If it was deleted, drop it
            // rather than failing the duplicate (the copy simply starts uncategorised).
            Guid? categoryId = source.CategoryId;
            CategoryInfo? categoryInfo = null;
            if (categoryId.HasValue)
            {
                categoryInfo = await _categoryGrpcClient.GetCategoryInfoAsync(categoryId.Value, userId, cancellationToken);
                if (categoryInfo is null) categoryId = null;
            }

            // Copy the shared audience, but re-validate friendship so a since-removed friend is not
            // silently re-granted access on the copy (mirrors CreateTodo's rule, fail-soft: drop,
            // don't throw).
            var sharedWith = source.SharedWith
                .Select(s => s.SharedWithUserId)
                .Where(id => id != Guid.Empty && id != userId)
                .Distinct()
                .ToList();
            if (sharedWith.Count > 0)
            {
                var friendIds = await _friendshipService.GetFriendIdsAsync(userId, cancellationToken);
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
                source.RequiredWorkers);

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
