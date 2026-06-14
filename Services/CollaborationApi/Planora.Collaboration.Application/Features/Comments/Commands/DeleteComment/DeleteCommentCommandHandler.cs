using MediatR;
using Planora.BuildingBlocks.Application.Context;
using Planora.BuildingBlocks.Application.Messaging.Events;
using Planora.BuildingBlocks.Application.Outbox;
using Planora.BuildingBlocks.Domain;
using Planora.BuildingBlocks.Domain.Exceptions;
using Planora.Collaboration.Application.Common;
using Planora.Collaboration.Application.Services;
using Planora.Collaboration.Domain.Repositories;

namespace Planora.Collaboration.Application.Features.Comments.Commands.DeleteComment
{
    public sealed class DeleteCommentCommandHandler : IRequestHandler<DeleteCommentCommand, Result>
    {
        private readonly ICommentRepository _commentRepository;
        private readonly IUnitOfWork _unitOfWork;
        private readonly ICurrentUserContext _currentUserContext;
        private readonly ITaskAccessService _taskAccessService;
        private readonly IOutboxRepository _outboxRepository;

        public DeleteCommentCommandHandler(
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

        public async Task<Result> Handle(DeleteCommentCommand request, CancellationToken cancellationToken)
        {
            var userId = _currentUserContext.UserId;

            var comment = await _commentRepository.GetByIdAsync(request.CommentId, cancellationToken)
                ?? throw new EntityNotFoundException("Comment", request.CommentId);

            if (comment.TaskId != request.TaskId)
                throw new EntityNotFoundException("Comment", request.CommentId);

            if (comment.IsSystemComment && !comment.IsGenesisComment)
                throw new ForbiddenException("System event comments cannot be deleted");

            var access = await _taskAccessService.CheckCommentAccessAsync(request.TaskId, userId, cancellationToken);
            if (!access.Exists)
                throw new EntityNotFoundException("Task", request.TaskId);

            var isAuthor = comment.AuthorId == userId;
            var isTaskOwner = access.OwnerId == userId;

            if (comment.IsGenesisComment && !isTaskOwner)
                throw new ForbiddenException("Only the task owner can delete the description");

            if (!isAuthor && !isTaskOwner)
                throw new ForbiddenException("Only the comment author or task owner can delete this comment");

            comment.MarkAsDeleted(userId);
            _commentRepository.Update(comment);
            await _unitOfWork.SaveChangesAsync(cancellationToken);

            // Live: the comment disappears from every open branch view of this task.
            await _outboxRepository.EnqueueIntegrationEventAsync(
                new RealtimeSyncIntegrationEvent(
                    RealtimeSyncAction.CommentDeleted, comment.Id, userId, branchTaskId: request.TaskId),
                cancellationToken);

            return Result.Success();
        }
    }
}
