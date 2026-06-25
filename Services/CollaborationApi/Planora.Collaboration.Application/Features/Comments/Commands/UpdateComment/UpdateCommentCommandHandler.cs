using MediatR;
using Planora.BuildingBlocks.Application.Context;
using Planora.BuildingBlocks.Application.Messaging.Events;
using Planora.BuildingBlocks.Application.Outbox;
using Planora.BuildingBlocks.Domain;
using Planora.BuildingBlocks.Domain.Exceptions;
using Planora.Collaboration.Application.Common;
using Planora.Collaboration.Application.DTOs;
using Planora.Collaboration.Application.Services;
using Planora.Collaboration.Domain.Enums;
using Planora.Collaboration.Domain.Repositories;

namespace Planora.Collaboration.Application.Features.Comments.Commands.UpdateComment
{
    public sealed class UpdateCommentCommandHandler : IRequestHandler<UpdateCommentCommand, Result<CommentDto>>
    {
        private readonly ICommentRepository _commentRepository;
        private readonly IUnitOfWork _unitOfWork;
        private readonly ICurrentUserContext _currentUserContext;
        private readonly IUserService _userService;
        private readonly ITaskAccessService _taskAccessService;
        private readonly IOutboxRepository _outboxRepository;

        public UpdateCommentCommandHandler(
            ICommentRepository commentRepository,
            IUnitOfWork unitOfWork,
            ICurrentUserContext currentUserContext,
            IUserService userService,
            ITaskAccessService taskAccessService,
            IOutboxRepository outboxRepository)
        {
            _commentRepository = commentRepository;
            _unitOfWork = unitOfWork;
            _currentUserContext = currentUserContext;
            _userService = userService;
            _taskAccessService = taskAccessService;
            _outboxRepository = outboxRepository;
        }

        public async Task<Result<CommentDto>> Handle(UpdateCommentCommand request, CancellationToken cancellationToken)
        {
            var userId = _currentUserContext.UserId;

            var comment = await _commentRepository.GetByIdAsync(request.CommentId, cancellationToken)
                ?? throw new EntityNotFoundException("Comment", request.CommentId);

            if (comment.TaskId != request.TaskId)
                throw new EntityNotFoundException("Comment", request.CommentId);

            // Authorise against the live task access rules owned by TodoApi (sharing/friendship),
            // mirroring Add/Delete/Get handlers. Without this a user who authored a comment but
            // has since lost access to the task could still edit it (IDOR/BOLA).
            var access = await _taskAccessService.CheckCommentAccessAsync(request.TaskId, userId, cancellationToken);
            if (!access.Exists)
                throw new EntityNotFoundException("Task", request.TaskId);
            if (!access.HasAccess)
                throw new ForbiddenException("You do not have access to this task");

            // The task description ("Author's Note") is no longer a stored comment — it is edited
            // on the task itself (PUT /todos), so this handler only edits real user comments.
            comment.UpdateContent(request.Content, userId);

            _commentRepository.Update(comment);
            await _unitOfWork.SaveChangesAsync(cancellationToken);

            // Live: the edited content reconciles in every open branch view of this task.
            await _outboxRepository.EnqueueIntegrationEventAsync(
                new RealtimeSyncIntegrationEvent(
                    RealtimeSyncAction.CommentUpdated, comment.Id, userId, branchTaskId: request.TaskId),
                cancellationToken);

            // Resolve the comment author AND (when this is a reply) the quoted author's current
            // name + avatar live, in ONE batch — so the PUT response is the same complete, enriched
            // shape AddComment/GetComments return instead of a bare comment missing its reply block.
            var idsToResolve = new List<Guid> { comment.AuthorId };
            if (comment.ReplyToAuthorId is { } replyAuthorId && replyAuthorId != Guid.Empty)
                idsToResolve.Add(replyAuthorId);

            var profiles = await _userService.GetUserProfilesAsync(idsToResolve, cancellationToken);

            string authorName = comment.AuthorName;
            string? authorAvatarUrl = null;
            if (comment.AuthorId != Guid.Empty && profiles.TryGetValue(comment.AuthorId, out var authorProfile))
            {
                if (!string.IsNullOrWhiteSpace(authorProfile.DisplayName)) authorName = authorProfile.DisplayName;
                authorAvatarUrl = authorProfile.AvatarUrl;
            }

            // Reply author name falls back to the snapshot captured at reply time when the user is
            // gone; the avatar is live-only (never snapshotted), and the preview is the stored snapshot.
            string? replyAuthorName = comment.ReplyToAuthorName;
            string? replyAuthorAvatarUrl = null;
            if (comment.ReplyToAuthorId is { } rid && rid != Guid.Empty && profiles.TryGetValue(rid, out var replyProfile))
            {
                if (!string.IsNullOrWhiteSpace(replyProfile.DisplayName)) replyAuthorName = replyProfile.DisplayName;
                replyAuthorAvatarUrl = replyProfile.AvatarUrl;
            }

            return Result<CommentDto>.Success(new CommentDto(
                comment.Id,
                comment.TaskId,
                comment.AuthorId,
                authorName,
                authorAvatarUrl,
                comment.Content,
                comment.CreatedAt,
                comment.UpdatedAt,
                IsOwn: comment.AuthorId == userId,
                IsEdited: comment.IsEdited,
                IsSystemComment: comment.IsSystemComment,
                IsGenesisComment: false,
                ReplyToType: comment.ReplyToType switch
                {
                    ReplyTargetType.Comment => "comment",
                    ReplyTargetType.Subtask => "subtask",
                    _ => null,
                },
                ReplyToId: comment.ReplyToId,
                ReplyToAuthorId: comment.ReplyToAuthorId,
                ReplyToAuthorName: replyAuthorName,
                ReplyToAuthorAvatarUrl: replyAuthorAvatarUrl,
                ReplyToPreview: comment.ReplyToPreview,
                ReplyToDeleted: comment.ReplyToDeleted));
        }
    }
}
