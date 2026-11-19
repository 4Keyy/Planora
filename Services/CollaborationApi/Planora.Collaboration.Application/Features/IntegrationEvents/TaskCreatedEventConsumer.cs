using Planora.BuildingBlocks.Application.Messaging;
using Planora.BuildingBlocks.Application.Messaging.Events;
using Planora.Collaboration.Domain.Entities;
using Planora.Collaboration.Application.Services;

namespace Planora.Collaboration.Application.Features.IntegrationEvents
{
    /// <summary>
    /// Materialises the creation entry for a task's timeline.
    /// </summary>
    public sealed class TaskCreatedEventConsumer : IIntegrationEventHandler<TaskCreatedIntegrationEvent>
    {
        private readonly IBranchTimeline _timeline;
        private readonly ILogger<TaskCreatedEventConsumer> _logger;

        public TaskCreatedEventConsumer(
            IBranchTimeline timeline,
            ILogger<TaskCreatedEventConsumer> logger)
        {
            _timeline = timeline;
            _logger = logger;
        }

        public async Task HandleAsync(TaskCreatedIntegrationEvent @event, CancellationToken cancellationToken)
        {
            var ownerName = string.IsNullOrWhiteSpace(@event.OwnerName) ? "Someone" : @event.OwnerName;

            // Only the "created the task" timeline event is materialised here. The description
            // ("Author's Note") is NOT copied into a genesis comment — it stays a single source
            // of truth in Todo and Collaboration synthesises the note on read (see
            // GetCommentsQueryHandler). This removes the description-duplication that left old
            // tasks with an empty branch and new tasks waiting on this event.
            var systemComment = Comment.CreateSystem(@event.TaskId, $"{ownerName} created the task");
            if (await _timeline.AppendAsync(systemComment, cancellationToken) != TimelineAppendResult.Added)
                return;

            _logger.LogInformation(
                "Materialised creation timeline for task {TaskId} (owner {OwnerId})",
                @event.TaskId, @event.OwnerId);
        }
    }
}
