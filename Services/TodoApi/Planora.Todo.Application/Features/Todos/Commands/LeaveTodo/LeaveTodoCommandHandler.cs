using Planora.BuildingBlocks.Domain;
using Planora.BuildingBlocks.Domain.Exceptions;
using Planora.BuildingBlocks.Application.Context;
using Planora.BuildingBlocks.Application.Messaging.Events;
using Planora.BuildingBlocks.Application.Outbox;
using Planora.Todo.Application.Common;
using Planora.Todo.Application.Services;
using Planora.Todo.Domain.Entities;
using Planora.Todo.Domain.Repositories;
using Microsoft.Extensions.Logging;

namespace Planora.Todo.Application.Features.Todos.Commands.LeaveTodo
{
    public sealed class LeaveTodoCommandHandler : IRequestHandler<LeaveTodoCommand, Result>
    {
        private readonly ITodoRepository _repository;
        private readonly IUnitOfWork _unitOfWork;
        private readonly ICurrentUserContext _currentUserContext;
        private readonly IOutboxRepository _outboxRepository;
        private readonly IFriendshipService _friendshipService;
        private readonly ILogger<LeaveTodoCommandHandler> _logger;

        public LeaveTodoCommandHandler(
            ITodoRepository repository,
            IUnitOfWork unitOfWork,
            ICurrentUserContext currentUserContext,
            IOutboxRepository outboxRepository,
            IFriendshipService friendshipService,
            ILogger<LeaveTodoCommandHandler> logger)
        {
            _repository = repository;
            _unitOfWork = unitOfWork;
            _currentUserContext = currentUserContext;
            _outboxRepository = outboxRepository;
            _friendshipService = friendshipService;
            _logger = logger;
        }

        public async Task<Result> Handle(LeaveTodoCommand request, CancellationToken cancellationToken)
        {
            var userId = _currentUserContext.UserId;
            if (userId == Guid.Empty)
                throw new UnauthorizedAccessException("User context is not available");

            var todoItem = await _repository.GetByIdWithIncludesTrackedAsync(request.TodoId, cancellationToken)
                ?? throw new EntityNotFoundException("TodoItem", request.TodoId);

            // Subtask in-work is per-user (the owner can opt in/out too), so the owner may leave a
            // subtask. On a normal task the owner is always its worker and cannot leave.
            var isSubtask = todoItem.IsSubtask;
            if (todoItem.UserId == userId && !isSubtask)
                throw new BusinessRuleViolationException("Owner cannot leave their own task");

            todoItem.RemoveWorker(userId);

            // Subtasks post no "left the task" notification — their in-work state is an anonymous count.
            if (!isSubtask)
            {
                var userName = _currentUserContext.Name ?? _currentUserContext.Email ?? userId.ToString();
                await _outboxRepository.EnqueueIntegrationEventAsync(
                    new TaskActivityIntegrationEvent(todoItem.Id, userId, userName, TaskActivityType.Left),
                    cancellationToken);

                // Live: worker count dropped → refresh the card everywhere and the branch timeline.
                var audience = await RealtimeAudience.ResolveAsync(todoItem, _friendshipService, cancellationToken);
                await _outboxRepository.EnqueueIntegrationEventAsync(
                    new RealtimeSyncIntegrationEvent(
                        RealtimeSyncAction.TaskUpdated, todoItem.Id, userId,
                        branchTaskId: todoItem.Id, audienceUserIds: audience),
                    cancellationToken);
            }
            else if (todoItem.ParentTodoId.HasValue)
            {
                await _outboxRepository.EnqueueIntegrationEventAsync(
                    new RealtimeSyncIntegrationEvent(
                        RealtimeSyncAction.SubtaskChanged, todoItem.Id, userId,
                        branchTaskId: todoItem.ParentTodoId.Value),
                    cancellationToken);
            }

            await _unitOfWork.SaveChangesAsync(cancellationToken);

            var activeWorkerTaskCount = await _repository.GetActiveWorkerTaskCountAsync(userId, cancellationToken);
            _logger.LogInformation(
                "User {UserId} left task {TodoId}. Active worker task count: {Count}",
                userId, todoItem.Id, activeWorkerTaskCount);

            return Result.Success();
        }
    }
}
