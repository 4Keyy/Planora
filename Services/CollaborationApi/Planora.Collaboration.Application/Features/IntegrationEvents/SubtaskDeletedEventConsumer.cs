using Planora.BuildingBlocks.Application.Messaging;
using Planora.BuildingBlocks.Application.Messaging.Events;
using Planora.Collaboration.Application.Services;

namespace Planora.Collaboration.Application.Features.IntegrationEvents
{
    /// <summary>
    /// Removes a deleted subtask's announcement comments from the PARENT task's branch. A subtask
    /// has no branch of its own, so deleting it must not wipe the parent timeline — only the
    /// identity-backed system comments it produced. Legacy entries with no source identity survive.
    /// Records the subtask's deletion so late activity cannot recreate its entries.
    /// </summary>
    public sealed class SubtaskDeletedEventConsumer : IIntegrationEventHandler<SubtaskDeletedIntegrationEvent>
    {
        private readonly IBranchTimeline _timeline;
        private readonly ILogger<SubtaskDeletedEventConsumer> _logger;

        public SubtaskDeletedEventConsumer(
            IBranchTimeline timeline,
            ILogger<SubtaskDeletedEventConsumer> logger)
        {
            _timeline = timeline;
            _logger = logger;
        }

        public async Task HandleAsync(SubtaskDeletedIntegrationEvent @event, CancellationToken cancellationToken)
        {
            await _timeline.DeleteSubtaskAsync(
                @event.ParentTaskId, @event.SubtaskId, @event.ActorId, cancellationToken);

            _logger.LogInformation(
                "Soft-deleted subtask {SubtaskId} announcement comments and flagged its reply quotes in parent branch {ParentTaskId} (actor {ActorId})",
                @event.SubtaskId, @event.ParentTaskId, @event.ActorId);
        }
    }
}
