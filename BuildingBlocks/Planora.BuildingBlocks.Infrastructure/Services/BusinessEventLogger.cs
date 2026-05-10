using Planora.BuildingBlocks.Application.Services;
using Planora.BuildingBlocks.Infrastructure.Logging;

namespace Planora.BuildingBlocks.Infrastructure.Services;

/// <summary>
/// Implementation of business event logger using Serilog.
/// </summary>
public class BusinessEventLogger : IBusinessEventLogger
{
    private readonly ILogger<BusinessEventLogger> _logger;

    public BusinessEventLogger(ILogger<BusinessEventLogger> logger)
    {
        _logger = logger;
    }

    public void LogBusinessEvent(string eventType, string message, object? data = null, string? userId = null)
    {
        EventTypeContext.SetEventType(eventType);

        using (_logger.BeginScope(new Dictionary<string, object>
        {
            ["EventType"] = eventType,
            ["UserId"] = userId ?? "Anonymous",
            ["Data"] = data ?? new { }
        }))
        {
            _logger.LogInformation("Business event: {Message}", message);
        }
    }

    public void LogUserAction(string action, string userId, object? details = null)
    {
        var eventType = $"USER_{action.ToUpperInvariant()}";

        LogBusinessEvent(eventType, $"{action} performed by user {userId}", details, userId);
    }
}