using Planora.BuildingBlocks.Application.Context;
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
        private readonly IRepository<TodoItem> _repository;
        private readonly IOutboxRepository _outboxRepository;
        private readonly IUnitOfWork _unitOfWork;
        private readonly ILogger<DeleteTodoCommandHandler> _logger;
        private readonly ICurrentUserContext _currentUserContext;

        public DeleteTodoCommandHandler(
            IRepository<TodoItem> repository,
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

            // The task's comment timeline ("ветка") lives in the Collaboration service. Publish a
            // deletion fact via the outbox; Collaboration cascade-soft-deletes the comments. INV-COMM-3.
            await _outboxRepository.EnqueueIntegrationEventAsync(
                new TaskDeletedIntegrationEvent(todoItem.Id, userId),
                cancellationToken);

            await _unitOfWork.SaveChangesAsync(cancellationToken);

            _logger.LogInformation("Todo item deleted: {TodoId} by user {UserId}", request.TodoId, userId);

            return Result.Success();
        }
    }
}
