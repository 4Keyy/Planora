using Planora.BuildingBlocks.Domain;
using Planora.BuildingBlocks.Domain.Exceptions;
using Planora.BuildingBlocks.Application.Context;
using Planora.Todo.Application.DTOs;
using Planora.Todo.Application.Services;
using Planora.Todo.Domain.Repositories;

namespace Planora.Todo.Application.Features.Todos.Commands.UpdateComment
{
    public sealed class UpdateCommentCommandHandler : IRequestHandler<UpdateCommentCommand, Result<TodoCommentDto>>
    {
        private readonly ITodoCommentRepository _commentRepository;
        private readonly ITodoRepository _todoRepository;
        private readonly IUnitOfWork _unitOfWork;
        private readonly ICurrentUserContext _currentUserContext;
        private readonly IUserService _userService;

        public UpdateCommentCommandHandler(
            ITodoCommentRepository commentRepository,
            ITodoRepository todoRepository,
            IUnitOfWork unitOfWork,
            ICurrentUserContext currentUserContext,
            IUserService userService)
        {
            _commentRepository = commentRepository;
            _todoRepository = todoRepository;
            _unitOfWork = unitOfWork;
            _currentUserContext = currentUserContext;
            _userService = userService;
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

            // Genesis comments are authored by the task owner (AuthorId is Empty); for them we
            // resolve the avatar of the todo's owner, not the current editor.
            var resolvedAuthorId = comment.IsGenesisComment ? userId : comment.AuthorId;
            string? authorAvatarUrl = null;
            if (resolvedAuthorId != Guid.Empty)
            {
                var avatars = await _userService.GetUserAvatarsAsync(new[] { resolvedAuthorId }, cancellationToken);
                avatars.TryGetValue(resolvedAuthorId, out authorAvatarUrl);
            }

            return Result<TodoCommentDto>.Success(new TodoCommentDto(
                comment.Id,
                comment.TodoItemId,
                comment.AuthorId,
                comment.AuthorName,
                authorAvatarUrl,
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
