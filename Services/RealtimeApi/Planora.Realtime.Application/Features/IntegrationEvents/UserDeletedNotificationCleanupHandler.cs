using Planora.BuildingBlocks.Application.Messaging;
using Planora.BuildingBlocks.Application.Messaging.Events;
using Planora.Realtime.Application.Interfaces;

namespace Planora.Realtime.Application.Features.IntegrationEvents;

/// <summary>
/// Cascade-cleans the notification log when a user is deleted in AuthApi, removing every notification
/// (and delivery row) addressed to that user. Without it a deleted account would leave its whole
/// notification history orphaned. Naturally idempotent.
/// </summary>
public sealed class UserDeletedNotificationCleanupHandler : IIntegrationEventHandler<UserDeletedIntegrationEvent>
{
    private readonly INotificationStore _store;
    private readonly ILogger<UserDeletedNotificationCleanupHandler> _logger;

    public UserDeletedNotificationCleanupHandler(
        INotificationStore store,
        ILogger<UserDeletedNotificationCleanupHandler> logger)
    {
        _store = store;
        _logger = logger;
    }

    public async Task HandleAsync(UserDeletedIntegrationEvent @event, CancellationToken cancellationToken = default)
    {
        var removed = await _store.DeleteByUserIdAsync(@event.UserId, cancellationToken);
        if (removed > 0)
            _logger.LogInformation("Removed {Count} notification(s) for deleted user {UserId}", removed, @event.UserId);
    }
}
