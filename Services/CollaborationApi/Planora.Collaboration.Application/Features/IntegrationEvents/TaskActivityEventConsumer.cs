using Planora.BuildingBlocks.Application.Messaging;
using Planora.BuildingBlocks.Application.Messaging.Events;
using Planora.Collaboration.Domain.Entities;
using Planora.Collaboration.Domain.Repositories;

namespace Planora.Collaboration.Application.Features.IntegrationEvents
{
    /// <summary>
    /// Appends the system comment for a task lifecycle transition (complete / start / leave),
    /// which TodoApi used to write inline. The sentence templates live here — the event carries
    /// only the structured fact and the actor's display name.
    /// </summary>
    public sealed class TaskActivityEventConsumer : IIntegrationEventHandler<TaskActivityIntegrationEvent>
    {
        private readonly ICommentRepository _commentRepository;
        private readonly IUnitOfWork _unitOfWork;
        private readonly ILogger<TaskActivityEventConsumer> _logger;

        public TaskActivityEventConsumer(
            ICommentRepository commentRepository,
            IUnitOfWork unitOfWork,
            ILogger<TaskActivityEventConsumer> logger)
        {
            _commentRepository = commentRepository;
            _unitOfWork = unitOfWork;
            _logger = logger;
        }

        public async Task HandleAsync(TaskActivityIntegrationEvent @event, CancellationToken cancellationToken)
        {
            var actorName = string.IsNullOrWhiteSpace(@event.ActorName) ? "Someone" : @event.ActorName;

            var text = @event.ActivityType switch
            {
                TaskActivityType.Completed => $"{actorName} completed the task",
                TaskActivityType.StartedWorking => $"{actorName} started working on the task",
                TaskActivityType.Left => $"{actorName} left the task",
                _ => null
            };

            if (text is null)
            {
                _logger.LogWarning(
                    "Unknown TaskActivityType '{ActivityType}' for task {TaskId} — skipping",
                    @event.ActivityType, @event.TaskId);
                return;
            }

            var systemComment = Comment.CreateSystem(@event.TaskId, text);
            await _commentRepository.AddAsync(systemComment, cancellationToken);
            await _unitOfWork.SaveChangesAsync(cancellationToken);

            _logger.LogInformation(
                "Appended '{ActivityType}' system comment for task {TaskId} by actor {ActorId}",
                @event.ActivityType, @event.TaskId, @event.ActorId);
        }
    }
}
