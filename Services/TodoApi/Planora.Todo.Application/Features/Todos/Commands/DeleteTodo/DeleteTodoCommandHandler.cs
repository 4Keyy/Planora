using Planora.BuildingBlocks.Application.Context;
using Planora.BuildingBlocks.Application.Messaging.Events;
using Planora.BuildingBlocks.Application.Outbox;
using Planora.BuildingBlocks.Domain;
using Planora.BuildingBlocks.Domain.Exceptions;
using Planora.Todo.Application.Common;
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

        public DeleteTodoCommandHandler(
            ITodoRepository repository,
            IOutboxRepository outboxRepository,
            IUnitOfWork unitOfWork,
            ILogger<DeleteTodoCommandHandler> logger,
            ICurrentUserContext currentUserContext)
        {
            _repository = repository;
            _outboxRepository = outboxRepository;
            _unitOfWork = unitOfWork;
            _logger = logger;
            _currentUserContext = currentUserContext;
        }

        public async Task<Result> Handle(DeleteTodoCommand request, CancellationToken cancellationToken)
        {
            var userId = _currentUserContext.UserId;

            var todoItem = await _repository.GetByIdAsync(request.TodoId, cancellationToken)
                ?? throw new EntityNotFoundException("TodoItem", request.TodoId);

            if (todoItem.UserId != userId)
                throw new ForbiddenException("You can only delete your own todo items. Friends cannot delete your public tasks");

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
                // A subtask has no branch of its own — its only footprint is the announcement
                // comments it left in the PARENT's branch. Remove exactly those, not a whole branch.
                await _outboxRepository.EnqueueIntegrationEventAsync(
                    new SubtaskDeletedIntegrationEvent(
                        todoItem.ParentTodoId!.Value, todoItem.Id, userId, todoItem.Title),
                    cancellationToken);
            }
            else
            {
                await _outboxRepository.EnqueueIntegrationEventAsync(
                    new TaskDeletedIntegrationEvent(todoItem.Id, userId),
                    cancellationToken);
            }

            await _unitOfWork.SaveChangesAsync(cancellationToken);

            _logger.LogInformation("Todo item deleted: {TodoId} by user {UserId}", request.TodoId, userId);

            return Result.Success();
        }
    }
}
