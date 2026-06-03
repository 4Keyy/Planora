using Planora.BuildingBlocks.Application.Messaging;
using Planora.BuildingBlocks.Application.Messaging.Events;
using Planora.Collaboration.Domain.Repositories;

namespace Planora.Collaboration.Application.Features.IntegrationEvents
{
    /// <summary>
    /// Removes a deleted subtask's announcement comments from the PARENT task's branch. A subtask
    /// has no branch of its own, so deleting it must not wipe the parent timeline — only the
    /// "added a subtask: …" / "completed a subtask: …" system comments it produced. Naturally
    /// idempotent: a redelivered event finds no remaining matching comments.
    /// </summary>
    public sealed class SubtaskDeletedEventConsumer : IIntegrationEventHandler<SubtaskDeletedIntegrationEvent>
    {
        private readonly ICommentRepository _commentRepository;
        private readonly IUnitOfWork _unitOfWork;
        private readonly ILogger<SubtaskDeletedEventConsumer> _logger;

        public SubtaskDeletedEventConsumer(
            ICommentRepository commentRepository,
            IUnitOfWork unitOfWork,
            ILogger<SubtaskDeletedEventConsumer> logger)
        {
            _commentRepository = commentRepository;
            _unitOfWork = unitOfWork;
            _logger = logger;
        }

        public async Task HandleAsync(SubtaskDeletedIntegrationEvent @event, CancellationToken cancellationToken)
        {
            await _commentRepository.SoftDeleteSubtaskActivityAsync(
                @event.ParentTaskId, @event.Title, @event.ActorId, cancellationToken);
            await _unitOfWork.SaveChangesAsync(cancellationToken);

            _logger.LogInformation(
                "Soft-deleted subtask {SubtaskId} announcement comments in parent branch {ParentTaskId} (actor {ActorId})",
                @event.SubtaskId, @event.ParentTaskId, @event.ActorId);
        }
    }
}
