using Planora.BuildingBlocks.Application.Context;
using Planora.BuildingBlocks.Application.Messaging.Events;
using Planora.BuildingBlocks.Application.Outbox;
using Planora.BuildingBlocks.Domain;
using Planora.BuildingBlocks.Domain.Exceptions;
using Planora.Todo.Application.Common;
using Planora.Todo.Application.Services;
using Planora.Todo.Domain.Repositories;
using MediatR;

namespace Planora.Todo.Application.Features.Todos.Commands.DeleteTodo
{
    public sealed class DeleteTodoCommandHandler : IRequestHandler<DeleteTodoCommand, Result>
    {
        private readonly ITodoRepository _repository;
        private readonly IOutboxRepository _outboxRepository;
        private readonly IUnitOfWork _unitOfWork;
        private readonly ILogger<DeleteTodoCommandHandler> _logger;
        private readonly ICurrentUserContext _currentUserContext;
        private readonly IFriendshipService _friendshipService;

        public DeleteTodoCommandHandler(
            ITodoRepository repository,
            IOutboxRepository outboxRepository,
            IUnitOfWork unitOfWork,
            ILogger<DeleteTodoCommandHandler> logger,
            ICurrentUserContext currentUserContext,
            IFriendshipService friendshipService)
        {
            _repository = repository;
            _outboxRepository = outboxRepository;
            _unitOfWork = unitOfWork;
            _logger = logger;
            _currentUserContext = currentUserContext;
            _friendshipService = friendshipService;
        }

        public async Task<Result> Handle(DeleteTodoCommand request, CancellationToken cancellationToken)
        {
            var userId = _currentUserContext.UserId;

            // Load with includes so the feed audience (shared-with set) can be resolved before the
            // task is soft-deleted — everyone who could see it must be told to drop the card.
            var todoItem = await _repository.GetByIdWithIncludesTrackedAsync(request.TodoId, cancellationToken)
                ?? throw new EntityNotFoundException("TodoItem", request.TodoId);

            // The owner may delete their own items; a SUBTASK's creator may also delete the subtask
            // they added, even on a task owned by someone else.
            var canDelete = todoItem.UserId == userId
                || (todoItem.IsSubtask && todoItem.CreatedByUserId == userId);
            if (!canDelete)
                throw new ForbiddenException("You can only delete your own todo items. Friends cannot delete your public tasks");

            // Capture the feed audience while the task is still alive and its shares are loaded.
            var audience = todoItem.IsSubtask
                ? (IReadOnlyList<Guid>)System.Array.Empty<Guid>()
                : await RealtimeAudience.ResolveAsync(todoItem, _friendshipService, cancellationToken, _logger);

            todoItem.MarkAsDeleted(userId);
            _repository.Update(todoItem);

            // Deleting a task removes its whole subtree: soft-delete every subtask in the same
            // unit of work. (A subtask itself has no children, so this is a no-op for subtasks.)
            if (!todoItem.IsSubtask)
            {
                var subtasks = await _repository.GetSubtasksTrackedAsync(todoItem.Id, cancellationToken);
                foreach (var subtask in subtasks)
                {
                    subtask.MarkAsDeleted(userId);
                    _repository.Update(subtask);
                }
            }

            // The task's comment timeline ("ветка") lives in the Collaboration service. Publish a
            // deletion fact via the outbox; Collaboration cascade-soft-deletes the comments. INV-COMM-3.
            if (todoItem.IsSubtask)
            {
                var parentId = todoItem.ParentTodoId!.Value;
                // A subtask has no branch of its own — its only footprint is the announcement
                // comments it left in the PARENT's branch. Remove exactly those, not a whole branch.
                await _outboxRepository.EnqueueIntegrationEventAsync(
                    new SubtaskDeletedIntegrationEvent(parentId, todoItem.Id, userId, todoItem.Title),
                    cancellationToken);

                // Live: the parent's open branch refreshes its subtask list.
                await _outboxRepository.EnqueueIntegrationEventAsync(
                    new RealtimeSyncIntegrationEvent(
                        RealtimeSyncAction.SubtaskChanged, todoItem.Id, userId, branchTaskId: parentId),
                    cancellationToken);
            }
            else
            {
                await _outboxRepository.EnqueueIntegrationEventAsync(
                    new TaskDeletedIntegrationEvent(todoItem.Id, userId),
                    cancellationToken);

                // Live: drop the card from every viewer's feed, and tell any open branch the task
                // is gone so the view can close itself.
                await _outboxRepository.EnqueueIntegrationEventAsync(
                    new RealtimeSyncIntegrationEvent(
                        RealtimeSyncAction.TaskDeleted, todoItem.Id, userId,
                        branchTaskId: todoItem.Id, audienceUserIds: audience),
                    cancellationToken);
            }

            await _unitOfWork.SaveChangesAsync(cancellationToken);

            _logger.LogInformation("Todo item deleted: {TodoId} by user {UserId}", request.TodoId, userId);

            return Result.Success();
        }
    }
}
