using Planora.BuildingBlocks.Domain;
using Planora.BuildingBlocks.Domain.Exceptions;
using Planora.BuildingBlocks.Infrastructure.Context;
using Planora.Todo.Domain.Repositories;

namespace Planora.Todo.Application.Features.Todos.Commands.DeleteComment
{
    public sealed class DeleteCommentCommandHandler : IRequestHandler<DeleteCommentCommand, Result>
    {
        private readonly ITodoCommentRepository _commentRepository;
        private readonly ITodoRepository _todoRepository;
        private readonly IUnitOfWork _unitOfWork;
        private readonly ICurrentUserContext _currentUserContext;

        public DeleteCommentCommandHandler(
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

        public async Task<Result> Handle(DeleteCommentCommand request, CancellationToken cancellationToken)
        {
            var userId = _currentUserContext.UserId;

            var comment = await _commentRepository.GetByIdAsync(request.CommentId, cancellationToken)
                ?? throw new EntityNotFoundException("TodoItemComment", request.CommentId);

            if (comment.TodoItemId != request.TodoId)
                throw new EntityNotFoundException("TodoItemComment", request.CommentId);

            var todoItem = await _todoRepository.GetByIdWithIncludesAsync(request.TodoId, cancellationToken)
                ?? throw new EntityNotFoundException("TodoItem", request.TodoId);

            var isAuthor = comment.AuthorId == userId;
            var isTodoOwner = todoItem.UserId == userId;

            if (!isAuthor && !isTodoOwner)
                throw new ForbiddenException("Only the comment author or task owner can delete this comment");

            comment.MarkAsDeleted(userId);
            _commentRepository.Update(comment);
            await _unitOfWork.SaveChangesAsync(cancellationToken);

            return Result.Success();
        }
    }
}
