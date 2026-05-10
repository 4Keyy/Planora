using Microsoft.AspNetCore.SignalR;
using Planora.Realtime.Application.Interfaces;

namespace Planora.Realtime.Application.Handlers;

public sealed class NotificationEventHandler : IIntegrationEventHandler<NotificationEvent>
{
    private readonly ILogger<NotificationEventHandler> _logger;
    private readonly INotificationService _notificationService;

    public NotificationEventHandler(
        ILogger<NotificationEventHandler> logger,
        INotificationService notificationService)
    {
        _logger = logger;
        _notificationService = notificationService;
    }

    public async Task HandleAsync(NotificationEvent @event, CancellationToken cancellationToken = default)
    {
        _logger.LogInformation(
            "📬 Handling NotificationEvent for UserId={UserId}, Title={Title}",
            @event.UserId,
            @event.Title);

        try
        {
            await _notificationService.SendNotificationAsync(
                @event.UserId.ToString(),
                @event.Message,
                @event.Type,
                cancellationToken);

            _logger.LogInformation("✅ Notification sent to user {UserId}", @event.UserId);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "❌ Failed to send notification to user {UserId}", @event.UserId);
            throw;
        }
    }
}
