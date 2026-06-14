using System.Text.Json;
using MediatR;
using Planora.BuildingBlocks.Application.Context;
using Planora.BuildingBlocks.Application.Messaging.Events;
using Planora.BuildingBlocks.Application.Outbox;
using Planora.BuildingBlocks.Domain;
using Planora.BuildingBlocks.Domain.Exceptions;
using Planora.Collaboration.Application.Common;
using Planora.Collaboration.Application.DTOs;
using Planora.Collaboration.Application.Services;
using Planora.Collaboration.Domain.Entities;
using Planora.Collaboration.Domain.Enums;
using Planora.Collaboration.Domain.Repositories;

namespace Planora.Collaboration.Application.Features.Comments.Commands.AddComment
{
    public sealed class AddCommentCommandHandler : IRequestHandler<AddCommentCommand, Result<CommentDto>>
    {
        private readonly ICommentRepository _commentRepository;
        private readonly IUnitOfWork _unitOfWork;
        private readonly ICurrentUserContext _currentUserContext;
        private readonly ITaskAccessService _taskAccessService;
        private readonly IOutboxRepository _outboxRepository;
        private readonly IUserService _userService;

        public AddCommentCommandHandler(
            ICommentRepository commentRepository,
            IUnitOfWork unitOfWork,
            ICurrentUserContext currentUserContext,
            ITaskAccessService taskAccessService,
            IOutboxRepository outboxRepository,
            IUserService userService)
        {
            _commentRepository = commentRepository;
            _unitOfWork = unitOfWork;
            _currentUserContext = currentUserContext;
            _taskAccessService = taskAccessService;
            _outboxRepository = outboxRepository;
            _userService = userService;
        }

        public async Task<Result<CommentDto>> Handle(AddCommentCommand request, CancellationToken cancellationToken)
        {
            var userId = _currentUserContext.UserId;
            if (userId == Guid.Empty)
                throw new UnauthorizedAccessException("User context is not available");

            var access = await _taskAccessService.CheckCommentAccessAsync(request.TaskId, userId, cancellationToken);
            if (!access.Exists)
                throw new EntityNotFoundException("Task", request.TaskId);
            if (!access.HasAccess)
                throw new ForbiddenException("You do not have access to this task");

            var authorName = _currentUserContext.Name
                ?? _currentUserContext.Email
                ?? userId.ToString();

            // ── Resolve + validate the reply target (server-side snapshot, never client data) ──
            ReplyTarget? target = null;
            if (request.ReplyToType is not null && request.ReplyToId.HasValue)
            {
                target = await ResolveReplyTargetAsync(
                    request.TaskId, request.ReplyToType, request.ReplyToId.Value, cancellationToken);
            }

            var comment = target is null
                ? Comment.Create(request.TaskId, userId, authorName, request.Content)
                : Comment.CreateReply(
                    request.TaskId, userId, authorName, request.Content,
                    target.Type, target.Id, target.AuthorId, target.AuthorName, target.Preview);

            await _commentRepository.AddAsync(comment, cancellationToken);
            await _unitOfWork.SaveChangesAsync(cancellationToken);

            // Live: push the new message into the task's branch room so everyone with the branch
            // open sees it appear instantly (both directions). The client refetches the comment
            // slice through the authorized endpoint, so the signal carries no comment content.
            await _outboxRepository.EnqueueIntegrationEventAsync(
                new RealtimeSyncIntegrationEvent(
                    RealtimeSyncAction.CommentAdded, comment.Id, userId, branchTaskId: request.TaskId),
                cancellationToken);

            // Fan out notifications to every other task participant. Written to the outbox so
            // delivery is reliable and atomic-ish with the comment write (INV-COMM-3). RealtimeApi
            // consumes NotificationEvent and pushes it over SignalR. The quoted author gets a
            // dedicated "replied to you" instead of the generic line.
            await PublishNotificationsAsync(
                userId, authorName, access.ParticipantIds, target, cancellationToken);

            // Avatar URL comes from the live caller context — this is the author themselves,
            // so their JWT claim is the freshest source available on the write path.
            var authorAvatarUrl = string.IsNullOrEmpty(_currentUserContext.ProfilePictureUrl)
                ? null
                : _currentUserContext.ProfilePictureUrl;

            return Result<CommentDto>.Success(new CommentDto(
                comment.Id,
                comment.TaskId,
                comment.AuthorId,
                comment.AuthorName,
                authorAvatarUrl,
                comment.Content,
                comment.CreatedAt,
                comment.UpdatedAt,
                IsOwn: true,
                IsEdited: false,
                IsSystemComment: false,
                IsGenesisComment: false,
                ReplyToType: target?.Type switch
                {
                    ReplyTargetType.Comment => "comment",
                    ReplyTargetType.Subtask => "subtask",
                    _ => null,
                },
                ReplyToId: target?.Id,
                ReplyToAuthorId: target?.AuthorId,
                ReplyToAuthorName: target?.AuthorName,
                ReplyToAuthorAvatarUrl: target?.AuthorAvatarUrl,
                ReplyToPreview: comment.ReplyToPreview,
                ReplyToDeleted: false));
        }

        /// <summary>The validated, server-captured snapshot of what a reply quotes.</summary>
        private sealed record ReplyTarget(
            ReplyTargetType Type,
            Guid Id,
            Guid AuthorId,
            string? AuthorName,
            string? AuthorAvatarUrl,
            string? Preview);

        private async Task<ReplyTarget> ResolveReplyTargetAsync(
            Guid taskId, string replyToType, Guid replyToId, CancellationToken cancellationToken)
        {
            switch (replyToType.ToLowerInvariant())
            {
                case "comment":
                {
                    var targetComment = await _commentRepository.GetByIdAsync(replyToId, cancellationToken);

                    // Cross-task ids are treated as "not found" — same response as a genuinely
                    // missing comment, so a forged id cannot probe other branches (no oracle).
                    if (targetComment is null || targetComment.TaskId != taskId)
                        throw new EntityNotFoundException("Comment", replyToId);

                    // System events and the genesis note are timeline furniture, not messages.
                    if (targetComment.IsSystemComment || targetComment.IsGenesisComment)
                        return ThrowInvalidTarget();

                    var profile = await ResolveProfileAsync(targetComment.AuthorId, cancellationToken);

                    return new ReplyTarget(
                        ReplyTargetType.Comment,
                        targetComment.Id,
                        targetComment.AuthorId,
                        // Live name when available; the stored name is the fallback snapshot.
                        string.IsNullOrWhiteSpace(profile?.DisplayName) ? targetComment.AuthorName : profile!.DisplayName,
                        profile?.AvatarUrl,
                        Comment.TruncatePreview(targetComment.Content));
                }

                case "subtask":
                {
                    // Todo owns the task aggregate: it verifies the subtask exists, is alive and
                    // is a child of THIS task (INV-OWN-1), and returns the snapshot material.
                    var brief = await _taskAccessService.GetSubtaskBriefAsync(taskId, replyToId, cancellationToken);
                    if (!brief.Exists)
                        throw new EntityNotFoundException("Subtask", replyToId);

                    var profile = await ResolveProfileAsync(brief.AuthorId, cancellationToken);

                    return new ReplyTarget(
                        ReplyTargetType.Subtask,
                        replyToId,
                        brief.AuthorId,
                        profile?.DisplayName,
                        profile?.AvatarUrl,
                        Comment.TruncatePreview(brief.Title));
                }

                default:
                    return ThrowInvalidTarget();
            }

            static ReplyTarget ThrowInvalidTarget() =>
                throw new InvalidValueObjectException(
                    nameof(Comment), "Replies can only target a user comment, a reply, or a subtask");
        }

        private async Task<UserProfile?> ResolveProfileAsync(Guid userId, CancellationToken cancellationToken)
        {
            if (userId == Guid.Empty)
                return null;

            // Cached (60 s) batch service — a single-id lookup on the write path is cheap and
            // gives the immediate response the same live identity the read path would show.
            var profiles = await _userService.GetUserProfilesAsync(new[] { userId }, cancellationToken);
            return profiles.TryGetValue(userId, out var profile) ? profile : null;
        }

        private async Task PublishNotificationsAsync(
            Guid authorId,
            string authorName,
            IReadOnlyList<Guid> participantIds,
            ReplyTarget? target,
            CancellationToken cancellationToken)
        {
            var recipients = participantIds
                .Where(id => id != Guid.Empty && id != authorId)
                .Distinct()
                .ToList();

            foreach (var recipientId in recipients)
            {
                var isQuotedAuthor = target is not null && recipientId == target.AuthorId;

                var notification = isQuotedAuthor
                    ? new NotificationEvent(
                        recipientId,
                        "New reply",
                        target!.Type == ReplyTargetType.Subtask
                            ? $"{authorName} replied to your subtask"
                            : $"{authorName} replied to your message",
                        "ReplyAdded")
                    : new NotificationEvent(
                        recipientId,
                        "New comment",
                        $"{authorName} commented on a task",
                        "CommentAdded");

                var outboxMessage = new OutboxMessage(
                    notification.GetType().AssemblyQualifiedName ?? notification.GetType().Name,
                    JsonSerializer.Serialize(notification),
                    DateTime.UtcNow);

                await _outboxRepository.AddAsync(outboxMessage, cancellationToken);
            }
        }
    }
}
