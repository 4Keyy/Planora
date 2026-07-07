using Planora.BuildingBlocks.Application.Messaging;
using Planora.BuildingBlocks.Application.Messaging.Events;
using Planora.Realtime.Application.Interfaces;

namespace Planora.Realtime.Application.Features.IntegrationEvents;

/// <summary>
/// Cascade-cleans the notification log when a task is deleted in TodoApi. The durable
/// <c>Notification</c> rows carry a <c>TaskId</c> but have no cross-service foreign key, so without this
/// consumer a deleted task would leave orphaned card-dot / branch-badge notifications behind forever.
/// Naturally idempotent — a redelivered event finds nothing left to remove.
/// </summary>
public sealed class TaskDeletedNotificationCleanupHandler : IIntegrationEventHandler<TaskDeletedIntegrationEvent>
{
    private readonly INotificationStore _store;
    private readonly ILogger<TaskDeletedNotificationCleanupHandler> _logger;

    public TaskDeletedNotificationCleanupHandler(
        INotificationStore store,
        ILogger<TaskDeletedNotificationCleanupHandler> logger)
    {
        _store = store;
        _logger = logger;
    }

    public async Task HandleAsync(TaskDeletedIntegrationEvent @event, CancellationToken cancellationToken = default)
    {
        var removed = await _store.DeleteByTaskIdAsync(@event.TaskId, cancellationToken);
        if (removed > 0)
            _logger.LogInformation("Removed {Count} notification(s) for deleted task {TaskId}", removed, @event.TaskId);
    }
}
