using Planora.BuildingBlocks.Application.Messaging;
using Planora.BuildingBlocks.Application.Messaging.Events;
using Planora.Collaboration.Domain.Entities;
using Planora.Collaboration.Application.Services;

namespace Planora.Collaboration.Application.Features.IntegrationEvents
{
    /// <summary>
    /// Appends the system comment for a task lifecycle transition (complete / start / leave),
    /// which TodoApi used to write inline. The sentence templates live here — the event carries
    /// only the structured fact and the actor's display name.
    /// </summary>
    public sealed class TaskActivityEventConsumer : IIntegrationEventHandler<TaskActivityIntegrationEvent>
    {
        private readonly IBranchTimeline _timeline;
        private readonly ILogger<TaskActivityEventConsumer> _logger;

        public TaskActivityEventConsumer(
            IBranchTimeline timeline,
            ILogger<TaskActivityEventConsumer> logger)
        {
            _timeline = timeline;
            _logger = logger;
        }

        public async Task HandleAsync(TaskActivityIntegrationEvent @event, CancellationToken cancellationToken)
        {
            var actorName = string.IsNullOrWhiteSpace(@event.ActorName) ? "Someone" : @event.ActorName;
            var detail = @event.Detail?.Trim();

            var text = @event.ActivityType switch
            {
                TaskActivityType.Completed => $"{actorName} completed the task",
                TaskActivityType.StartedWorking => $"{actorName} started working on the task",
                TaskActivityType.Left => $"{actorName} left the task",
                TaskActivityType.SubtaskCreated => string.IsNullOrWhiteSpace(detail)
                    ? $"{actorName} added a subtask"
                    : $"{actorName} added a subtask: {detail}",
                TaskActivityType.SubtaskCompleted => string.IsNullOrWhiteSpace(detail)
                    ? $"{actorName} completed a subtask"
                    : $"{actorName} completed a subtask: {detail}",
                _ => null
            };

            if (text is null)
            {
                _logger.LogWarning(
                    "Unknown TaskActivityType '{ActivityType}' for task {TaskId} — skipping",
                    @event.ActivityType, @event.TaskId);
                return;
            }

            var sourceSubtaskId = @event.ActivityType is TaskActivityType.SubtaskCreated or TaskActivityType.SubtaskCompleted
                ? @event.SourceSubtaskId
                : null;
            var systemComment = Comment.CreateSystem(@event.TaskId, text, sourceSubtaskId);
            if (await _timeline.AppendAsync(systemComment, cancellationToken) != TimelineAppendResult.Added)
                return;

            _logger.LogInformation(
                "Appended '{ActivityType}' system comment for task {TaskId} by actor {ActorId}",
                @event.ActivityType, @event.TaskId, @event.ActorId);
        }
    }
}
