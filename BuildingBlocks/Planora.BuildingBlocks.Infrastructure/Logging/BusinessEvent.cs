namespace Planora.BuildingBlocks.Infrastructure.Logging;

/// <summary>
/// Base class for structured business events that should be logged for audit and analytics.
/// Provides standardized event tracking across all microservices.
/// </summary>
public abstract class BusinessEvent
{
    public string EventType { get; }
    public DateTime Timestamp { get; }
    public string CorrelationId { get; set; } = string.Empty;
    public string? UserId { get; set; }
    public string ServiceName { get; set; } = string.Empty;

    protected BusinessEvent(string eventType)
    {
        EventType = eventType ?? throw new ArgumentNullException(nameof(eventType));
        Timestamp = DateTime.UtcNow;
    }

    /// <summary>
    /// Converts the business event to structured log properties.
    /// </summary>
    public virtual Dictionary<string, object> ToLogProperties()
    {
        return new Dictionary<string, object>
        {
            ["EventType"] = EventType,
            ["Timestamp"] = Timestamp,
            ["CorrelationId"] = CorrelationId,
            ["UserId"] = UserId ?? "System",
            ["ServiceName"] = ServiceName
        };
    }
}

/// <summary>
/// Extension methods for logging business events.
/// </summary>
public static class BusinessEventLoggingExtensions
{
    public static void LogBusinessEvent(this ILogger logger, BusinessEvent businessEvent, string message = "Business Event")
    {
        var properties = businessEvent.ToLogProperties();
        
        logger.LogInformation(
            "📊 {Message} | EventType: {EventType} | UserId: {UserId} | CorrelationId: {CorrelationId} | Properties: {@Properties}",
            message,
            businessEvent.EventType,
            businessEvent.UserId ?? "System",
            businessEvent.CorrelationId,
            properties);
    }
}
