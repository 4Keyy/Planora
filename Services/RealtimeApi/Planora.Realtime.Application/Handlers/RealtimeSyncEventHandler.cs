using Planora.Realtime.Application.Interfaces;

namespace Planora.Realtime.Application.Handlers;

/// <summary>
/// Translates a <see cref="RealtimeSyncIntegrationEvent"/> from the bus into SignalR pushes. One
/// event can drive two surfaces at once: the recipients' feed (their task list / dashboard) and a
/// task's branch room. The producer already resolved exactly who may see the feed change, so this
/// handler only routes — it makes no authorization decision of its own.
/// </summary>
public sealed class RealtimeSyncEventHandler : IIntegrationEventHandler<RealtimeSyncIntegrationEvent>
{
    private readonly ILogger<RealtimeSyncEventHandler> _logger;
    private readonly IRealtimeBroadcaster _broadcaster;

    public RealtimeSyncEventHandler(
        ILogger<RealtimeSyncEventHandler> logger,
        IRealtimeBroadcaster broadcaster)
    {
        _logger = logger;
        _broadcaster = broadcaster;
    }

    public async Task HandleAsync(RealtimeSyncIntegrationEvent @event, CancellationToken cancellationToken = default)
    {
        _logger.LogDebug(
            "🔄 RealtimeSync '{Action}' entity={EntityId} branch={BranchTaskId} audience={AudienceCount}",
            @event.Action, @event.EntityId, @event.BranchTaskId, @event.AudienceUserIds.Count);

        if (@event.AudienceUserIds.Count > 0)
        {
            await _broadcaster.FeedChangedAsync(
                @event.AudienceUserIds,
                @event.Action,
                @event.EntityId,
                @event.ActorId,
                cancellationToken);
        }

        if (@event.BranchTaskId != Guid.Empty)
        {
            await _broadcaster.BranchChangedAsync(
                @event.BranchTaskId,
                @event.Action,
                @event.EntityId,
                @event.ActorId,
                cancellationToken);
        }
    }
}
