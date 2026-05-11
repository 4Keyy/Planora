using Planora.BuildingBlocks.Domain;
using Planora.BuildingBlocks.Domain.Exceptions;
using Planora.BuildingBlocks.Infrastructure.Context;
using Planora.Todo.Application.DTOs;
using Planora.Todo.Domain.Repositories;

namespace Planora.Todo.Application.Features.Todos.Commands.AddComment
{
    public sealed class AddCommentCommandHandler : IRequestHandler<AddCommentCommand, Result<TodoCommentDto>>
    {
        private readonly ITodoRepository _todoRepository;
        private readonly ITodoCommentRepository _commentRepository;
        private readonly IUnitOfWork _unitOfWork;
        private readonly ICurrentUserContext _currentUserContext;

        public AddCommentCommandHandler(
            ITodoRepository todoRepository,
            ITodoCommentRepository commentRepository,
            IUnitOfWork unitOfWork,
            ICurrentUserContext currentUserContext)
        {
            _todoRepository = todoRepository;
            _commentRepository = commentRepository;
            _unitOfWork = unitOfWork;
            _currentUserContext = currentUserContext;
        }

        public async Task<Result<TodoCommentDto>> Handle(AddCommentCommand request, CancellationToken cancellationToken)
        {
            var userId = _currentUserContext.UserId;
            if (userId == Guid.Empty)
                throw new UnauthorizedAccessException("User context is not available");

            var todoItem = await _todoRepository.GetByIdWithIncludesAsync(request.TodoId, cancellationToken)
                ?? throw new EntityNotFoundException("TodoItem", request.TodoId);

            var isOwner = todoItem.UserId == userId;
            var hasAccess = isOwner ||
                todoItem.IsPublic ||
                todoItem.SharedWith.Any(s => s.SharedWithUserId == userId);

            if (!hasAccess)
                throw new ForbiddenException("You do not have access to this task");

            var authorName = _currentUserContext.Name
                ?? _currentUserContext.Email
                ?? userId.ToString();

            var comment = TodoItemComment.Create(todoItem.Id, userId, authorName, request.Content);
            await _commentRepository.AddAsync(comment, cancellationToken);
            await _unitOfWork.SaveChangesAsync(cancellationToken);

            return Result<TodoCommentDto>.Success(new TodoCommentDto(
                comment.Id,
                comment.TodoItemId,
                comment.AuthorId,
                comment.AuthorName,
                comment.Content,
                comment.CreatedAt,
                comment.UpdatedAt,
                IsOwn: true,
                IsEdited: false));
        }
    }
}
