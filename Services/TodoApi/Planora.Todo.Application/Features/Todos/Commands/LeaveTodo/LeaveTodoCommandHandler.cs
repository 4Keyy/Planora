using Planora.BuildingBlocks.Domain;
using Planora.BuildingBlocks.Domain.Exceptions;
using Planora.BuildingBlocks.Infrastructure.Context;
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
        private readonly ITodoCommentRepository _commentRepository;
        private readonly ILogger<LeaveTodoCommandHandler> _logger;

        public LeaveTodoCommandHandler(
            ITodoRepository repository,
            IUnitOfWork unitOfWork,
            ICurrentUserContext currentUserContext,
            ITodoCommentRepository commentRepository,
            ILogger<LeaveTodoCommandHandler> logger)
        {
            _repository = repository;
            _unitOfWork = unitOfWork;
            _currentUserContext = currentUserContext;
            _commentRepository = commentRepository;
            _logger = logger;
        }

        public async Task<Result> Handle(LeaveTodoCommand request, CancellationToken cancellationToken)
        {
            var userId = _currentUserContext.UserId;
            if (userId == Guid.Empty)
                throw new UnauthorizedAccessException("User context is not available");

            var todoItem = await _repository.GetByIdWithIncludesTrackedAsync(request.TodoId, cancellationToken)
                ?? throw new EntityNotFoundException("TodoItem", request.TodoId);

            if (todoItem.UserId == userId)
                throw new BusinessRuleViolationException("Owner cannot leave their own task");

            todoItem.RemoveWorker(userId);

            var userName = _currentUserContext.Name ?? _currentUserContext.Email ?? userId.ToString();
            var systemComment = TodoItemComment.CreateSystem(todoItem.Id, $"{userName} left the task");
            await _commentRepository.AddAsync(systemComment, cancellationToken);

            await _unitOfWork.SaveChangesAsync(cancellationToken);

            var activeWorkerTaskCount = await _repository.GetActiveWorkerTaskCountAsync(userId, cancellationToken);
            _logger.LogInformation(
                "User {UserId} left task {TodoId}. Active worker task count: {Count}",
                userId, todoItem.Id, activeWorkerTaskCount);

            return Result.Success();
        }
    }
}
