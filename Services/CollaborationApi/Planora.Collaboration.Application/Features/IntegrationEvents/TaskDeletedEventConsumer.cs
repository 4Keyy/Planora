using Planora.BuildingBlocks.Application.Messaging;
using Planora.BuildingBlocks.Application.Messaging.Events;
using Planora.Collaboration.Application.Services;

namespace Planora.Collaboration.Application.Features.IntegrationEvents
{
    /// <summary>
    /// Cascade-deletes a task's timeline when the task is deleted in TodoApi. Replaces the
    /// former in-process soft-delete that TodoApi performed in the same transaction; now driven
    /// by an integration event. A deletion marker also blocks late timeline writes.
    /// </summary>
    public sealed class TaskDeletedEventConsumer : IIntegrationEventHandler<TaskDeletedIntegrationEvent>
    {
        private readonly IBranchTimeline _timeline;
        private readonly ILogger<TaskDeletedEventConsumer> _logger;

        public TaskDeletedEventConsumer(
            IBranchTimeline timeline,
            ILogger<TaskDeletedEventConsumer> logger)
        {
            _timeline = timeline;
            _logger = logger;
        }

        public async Task HandleAsync(TaskDeletedIntegrationEvent @event, CancellationToken cancellationToken)
        {
            await _timeline.DeleteTaskAsync(@event.TaskId, @event.ActorId, cancellationToken);

            _logger.LogInformation(
                "Soft-deleted timeline for deleted task {TaskId} (actor {ActorId})",
                @event.TaskId, @event.ActorId);
        }
    }
}
