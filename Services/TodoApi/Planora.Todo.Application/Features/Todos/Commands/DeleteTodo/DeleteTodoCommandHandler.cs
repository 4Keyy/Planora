using Planora.BuildingBlocks.Infrastructure.Context;
using Planora.BuildingBlocks.Domain;
using Planora.BuildingBlocks.Domain.Exceptions;
using Planora.Todo.Domain.Repositories;
using MediatR;

namespace Planora.Todo.Application.Features.Todos.Commands.DeleteTodo
{
    public sealed class DeleteTodoCommandHandler : IRequestHandler<DeleteTodoCommand, Result>
    {
        private readonly IRepository<TodoItem> _repository;
        private readonly ITodoCommentRepository _commentRepository;
        private readonly IUnitOfWork _unitOfWork;
        private readonly ILogger<DeleteTodoCommandHandler> _logger;
        private readonly ICurrentUserContext _currentUserContext;

        public DeleteTodoCommandHandler(
            IRepository<TodoItem> repository,
            ITodoCommentRepository commentRepository,
            IUnitOfWork unitOfWork,
            ILogger<DeleteTodoCommandHandler> logger,
            ICurrentUserContext currentUserContext)
        {
            _repository = repository;
            _commentRepository = commentRepository;
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
            await _commentRepository.SoftDeleteByTodoIdAsync(todoItem.Id, userId, cancellationToken);
            await _unitOfWork.SaveChangesAsync(cancellationToken);

            _logger.LogInformation("Todo item deleted: {TodoId} by user {UserId}", request.TodoId, userId);

            return Result.Success();
        }
    }
}
