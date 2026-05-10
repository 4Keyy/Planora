namespace Planora.BuildingBlocks.Infrastructure.Logging;

/// <summary>
/// Context for storing event type across async operations.
/// </summary>
public static class EventTypeContext
{
    private static readonly AsyncLocal<string?> _eventType = new();

    /// <summary>
    /// Gets the current event type.
    /// </summary>
    public static string? GetEventType() => _eventType.Value;

    /// <summary>
    /// Sets the event type for the current async context.
    /// </summary>
    public static void SetEventType(string eventType)
    {
        _eventType.Value = eventType;
    }
}