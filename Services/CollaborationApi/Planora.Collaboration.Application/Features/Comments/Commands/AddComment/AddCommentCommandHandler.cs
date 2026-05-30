using System.Text.Json;
using MediatR;
using Planora.BuildingBlocks.Application.Context;
using Planora.BuildingBlocks.Application.Messaging.Events;
using Planora.BuildingBlocks.Application.Outbox;
using Planora.BuildingBlocks.Domain;
using Planora.BuildingBlocks.Domain.Exceptions;
using Planora.Collaboration.Application.DTOs;
using Planora.Collaboration.Application.Services;
using Planora.Collaboration.Domain.Entities;
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

        public AddCommentCommandHandler(
            ICommentRepository commentRepository,
            IUnitOfWork unitOfWork,
            ICurrentUserContext currentUserContext,
            ITaskAccessService taskAccessService,
            IOutboxRepository outboxRepository)
        {
            _commentRepository = commentRepository;
            _unitOfWork = unitOfWork;
            _currentUserContext = currentUserContext;
            _taskAccessService = taskAccessService;
            _outboxRepository = outboxRepository;
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

            var comment = Comment.Create(request.TaskId, userId, authorName, request.Content);
            await _commentRepository.AddAsync(comment, cancellationToken);
            await _unitOfWork.SaveChangesAsync(cancellationToken);

            // Fan out a notification to every other task participant. Written to the outbox so
            // delivery is reliable and atomic-ish with the comment write (INV-COMM-3). RealtimeApi
            // consumes NotificationEvent and pushes it over SignalR.
            await PublishNotificationsAsync(request.TaskId, userId, authorName, access.ParticipantIds, cancellationToken);

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
                IsSystemComment: false));
        }

        private async Task PublishNotificationsAsync(
            Guid taskId,
            Guid authorId,
            string authorName,
            IReadOnlyList<Guid> participantIds,
            CancellationToken cancellationToken)
        {
            var recipients = participantIds
                .Where(id => id != Guid.Empty && id != authorId)
                .Distinct()
                .ToList();

            foreach (var recipientId in recipients)
            {
                var notification = new NotificationEvent(
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
