using Planora.BuildingBlocks.Application.Messaging;
using Planora.BuildingBlocks.Application.Messaging.Events;
using Planora.Collaboration.Domain.Entities;
using Planora.Collaboration.Domain.Repositories;

namespace Planora.Collaboration.Application.Features.IntegrationEvents
{
    /// <summary>
    /// Materialises the timeline entries TodoApi used to write inline on task creation:
    /// the "{owner} created the task" system comment and the genesis comment (the task's
    /// initial description), now driven by an integration event so TodoApi owns no comment code.
    /// </summary>
    public sealed class TaskCreatedEventConsumer : IIntegrationEventHandler<TaskCreatedIntegrationEvent>
    {
        private readonly ICommentRepository _commentRepository;
        private readonly IUnitOfWork _unitOfWork;
        private readonly ILogger<TaskCreatedEventConsumer> _logger;

        public TaskCreatedEventConsumer(
            ICommentRepository commentRepository,
            IUnitOfWork unitOfWork,
            ILogger<TaskCreatedEventConsumer> logger)
        {
            _commentRepository = commentRepository;
            _unitOfWork = unitOfWork;
            _logger = logger;
        }

        public async Task HandleAsync(TaskCreatedIntegrationEvent @event, CancellationToken cancellationToken)
        {
            var ownerName = string.IsNullOrWhiteSpace(@event.OwnerName) ? "Someone" : @event.OwnerName;

            var systemComment = Comment.CreateSystem(@event.TaskId, $"{ownerName} created the task");
            await _commentRepository.AddAsync(systemComment, cancellationToken);

            if (!string.IsNullOrWhiteSpace(@event.Description))
            {
                // Idempotency guard: genesis is unique per task, so a redelivered event
                // never produces a second description.
                var existingGenesis = await _commentRepository.GetGenesisCommentAsync(@event.TaskId, cancellationToken);
                if (existingGenesis is null)
                {
                    var genesisComment = Comment.CreateGenesis(@event.TaskId, @event.Description!, ownerName);
                    await _commentRepository.AddAsync(genesisComment, cancellationToken);
                }
            }

            await _unitOfWork.SaveChangesAsync(cancellationToken);

            _logger.LogInformation(
                "Materialised creation timeline for task {TaskId} (owner {OwnerId})",
                @event.TaskId, @event.OwnerId);
        }
    }
}
