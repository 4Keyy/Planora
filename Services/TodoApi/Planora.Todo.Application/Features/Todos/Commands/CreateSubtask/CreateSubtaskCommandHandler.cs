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
        private readonly ICategoryGrpcClient _categoryGrpcClient;
        private readonly IOutboxRepository _outboxRepository;

        public CreateSubtaskCommandHandler(
            ITodoRepository repository,
            IUnitOfWork unitOfWork,
            IMapper mapper,
            ILogger<CreateSubtaskCommandHandler> logger,
            ICurrentUserContext currentUserContext,
            ICategoryGrpcClient categoryGrpcClient,
            IOutboxRepository outboxRepository)
        {
            _repository = repository;
            _unitOfWork = unitOfWork;
            _mapper = mapper;
            _logger = logger;
            _currentUserContext = currentUserContext;
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

            // Only the owner can add subtasks (IDOR guard); never to another subtask (no nesting).
            if (parent.UserId != userId)
                throw new ForbiddenException("You can only add subtasks to your own tasks");
            if (parent.IsSubtask)
                throw new ForbiddenException("A subtask cannot have its own subtasks");

            var subtask = TodoItem.CreateSubtask(
                parent,
                userId,
                request.Title,
                request.Description,
                request.Priority);

            await _repository.AddAsync(subtask, cancellationToken);

            // Announce the new subtask in the PARENT task's branch ("X added a subtask: …").
            var authorName = _currentUserContext.Name ?? _currentUserContext.Email ?? userId.ToString();
            await _outboxRepository.EnqueueIntegrationEventAsync(
                new TaskActivityIntegrationEvent(parent.Id, userId, authorName, TaskActivityType.SubtaskCreated, subtask.Title),
                cancellationToken);

            await _unitOfWork.SaveChangesAsync(cancellationToken);

            _logger.LogInformation(
                "Subtask {SubtaskId} created under task {ParentId} by user {UserId}",
                subtask.Id, parent.Id, userId);

            var dto = _mapper.Map<TodoItemDto>(subtask);

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
