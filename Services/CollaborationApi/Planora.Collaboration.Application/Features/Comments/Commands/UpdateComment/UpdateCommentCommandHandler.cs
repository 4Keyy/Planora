using MediatR;
using Planora.BuildingBlocks.Application.Context;
using Planora.BuildingBlocks.Domain;
using Planora.BuildingBlocks.Domain.Exceptions;
using Planora.Collaboration.Application.DTOs;
using Planora.Collaboration.Application.Services;
using Planora.Collaboration.Domain.Repositories;

namespace Planora.Collaboration.Application.Features.Comments.Commands.UpdateComment
{
    public sealed class UpdateCommentCommandHandler : IRequestHandler<UpdateCommentCommand, Result<CommentDto>>
    {
        private readonly ICommentRepository _commentRepository;
        private readonly IUnitOfWork _unitOfWork;
        private readonly ICurrentUserContext _currentUserContext;
        private readonly ITaskAccessService _taskAccessService;
        private readonly IUserService _userService;

        public UpdateCommentCommandHandler(
            ICommentRepository commentRepository,
            IUnitOfWork unitOfWork,
            ICurrentUserContext currentUserContext,
            ITaskAccessService taskAccessService,
            IUserService userService)
        {
            _commentRepository = commentRepository;
            _unitOfWork = unitOfWork;
            _currentUserContext = currentUserContext;
            _taskAccessService = taskAccessService;
            _userService = userService;
        }

        public async Task<Result<CommentDto>> Handle(UpdateCommentCommand request, CancellationToken cancellationToken)
        {
            var userId = _currentUserContext.UserId;

            var comment = await _commentRepository.GetByIdAsync(request.CommentId, cancellationToken)
                ?? throw new EntityNotFoundException("Comment", request.CommentId);

            if (comment.TaskId != request.TaskId)
                throw new EntityNotFoundException("Comment", request.CommentId);

            // Genesis comments are owned by the task owner (AuthorId is Empty); for them we
            // resolve the avatar of the task's owner, not the current editor.
            Guid resolvedAuthorId = comment.AuthorId;

            if (comment.IsGenesisComment)
            {
                var access = await _taskAccessService.CheckCommentAccessAsync(request.TaskId, userId, cancellationToken);
                if (!access.Exists)
                    throw new EntityNotFoundException("Task", request.TaskId);
                if (access.OwnerId != userId)
                    throw new ForbiddenException("Only the task owner can edit the description");

                comment.UpdateGenesisContent(request.Content, userId);
                resolvedAuthorId = access.OwnerId;
            }
            else
            {
                comment.UpdateContent(request.Content, userId);
            }

            _commentRepository.Update(comment);
            await _unitOfWork.SaveChangesAsync(cancellationToken);

            string? authorAvatarUrl = null;
            if (resolvedAuthorId != Guid.Empty)
            {
                var avatars = await _userService.GetUserAvatarsAsync(new[] { resolvedAuthorId }, cancellationToken);
                avatars.TryGetValue(resolvedAuthorId, out authorAvatarUrl);
            }

            return Result<CommentDto>.Success(new CommentDto(
                comment.Id,
                comment.TaskId,
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
