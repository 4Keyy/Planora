using Planora.BuildingBlocks.Application.Messaging;
using Planora.BuildingBlocks.Application.Messaging.Events;
using Planora.Collaboration.Domain.Repositories;

namespace Planora.Collaboration.Application.Features.IntegrationEvents
{
    /// <summary>
    /// Cascade-deletes a task's timeline when the task is deleted in TodoApi. Replaces the
    /// former in-process soft-delete that TodoApi performed in the same transaction; now driven
    /// by an integration event so TodoApi owns no comment code. Naturally idempotent — a
    /// redelivered event simply finds no remaining non-deleted comments.
    /// </summary>
    public sealed class TaskDeletedEventConsumer : IIntegrationEventHandler<TaskDeletedIntegrationEvent>
    {
        private readonly ICommentRepository _commentRepository;
        private readonly IUnitOfWork _unitOfWork;
        private readonly ILogger<TaskDeletedEventConsumer> _logger;

        public TaskDeletedEventConsumer(
            ICommentRepository commentRepository,
            IUnitOfWork unitOfWork,
            ILogger<TaskDeletedEventConsumer> logger)
        {
            _commentRepository = commentRepository;
            _unitOfWork = unitOfWork;
            _logger = logger;
        }

        public async Task HandleAsync(TaskDeletedIntegrationEvent @event, CancellationToken cancellationToken)
        {
            await _commentRepository.SoftDeleteByTaskIdAsync(@event.TaskId, @event.ActorId, cancellationToken);
            await _unitOfWork.SaveChangesAsync(cancellationToken);

            _logger.LogInformation(
                "Soft-deleted timeline for deleted task {TaskId} (actor {ActorId})",
                @event.TaskId, @event.ActorId);
        }
    }
}
