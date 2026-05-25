using Planora.BuildingBlocks.Domain;
using Planora.BuildingBlocks.Domain.Exceptions;
using Planora.BuildingBlocks.Application.Context;
using Planora.Todo.Application.DTOs;
using Planora.Todo.Domain.Repositories;

namespace Planora.Todo.Application.Features.Todos.Commands.UpdateComment
{
    public sealed class UpdateCommentCommandHandler : IRequestHandler<UpdateCommentCommand, Result<TodoCommentDto>>
    {
        private readonly ITodoCommentRepository _commentRepository;
        private readonly ITodoRepository _todoRepository;
        private readonly IUnitOfWork _unitOfWork;
        private readonly ICurrentUserContext _currentUserContext;

        public UpdateCommentCommandHandler(
            ITodoCommentRepository commentRepository,
            ITodoRepository todoRepository,
            IUnitOfWork unitOfWork,
            ICurrentUserContext currentUserContext)
        {
            _commentRepository = commentRepository;
            _todoRepository = todoRepository;
            _unitOfWork = unitOfWork;
            _currentUserContext = currentUserContext;
        }

        public async Task<Result<TodoCommentDto>> Handle(UpdateCommentCommand request, CancellationToken cancellationToken)
        {
            var userId = _currentUserContext.UserId;

            var comment = await _commentRepository.GetByIdAsync(request.CommentId, cancellationToken)
                ?? throw new EntityNotFoundException("TodoItemComment", request.CommentId);

            if (comment.TodoItemId != request.TodoId)
                throw new EntityNotFoundException("TodoItemComment", request.CommentId);

            if (comment.IsGenesisComment)
            {
                var todoItem = await _todoRepository.GetByIdWithIncludesAsync(request.TodoId, cancellationToken)
                    ?? throw new EntityNotFoundException("TodoItem", request.TodoId);

                if (todoItem.UserId != userId)
                    throw new ForbiddenException("Only the task owner can edit the description");

                comment.UpdateGenesisContent(request.Content, userId);
            }
            else
            {
                comment.UpdateContent(request.Content, userId);
            }

            _commentRepository.Update(comment);
            await _unitOfWork.SaveChangesAsync(cancellationToken);

            return Result<TodoCommentDto>.Success(new TodoCommentDto(
                comment.Id,
                comment.TodoItemId,
                comment.AuthorId,
                comment.AuthorName,
                comment.Content,
                comment.CreatedAt,
                comment.UpdatedAt,
                IsOwn: !comment.IsGenesisComment,
                IsEdited: comment.IsEdited,
                IsSystemComment: comment.IsSystemComment,
                IsGenesisComment: comment.IsGenesisComment));
        }
    }
}
