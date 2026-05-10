namespace Planora.BuildingBlocks.Infrastructure.Logging;

/// <summary>
/// Context for storing span ID across async operations.
/// </summary>
public static class SpanIdContext
{
    private static readonly AsyncLocal<string?> _spanId = new();

    /// <summary>
    /// Gets the current span ID.
    /// </summary>
    public static string? GetSpanId() => _spanId.Value;

    /// <summary>
    /// Sets the span ID for the current async context.
    /// </summary>
    public static void SetSpanId(string spanId)
    {
        _spanId.Value = spanId;
    }

    /// <summary>
    /// Generates a new span ID if none exists.
    /// </summary>
    public static string GetOrGenerateSpanId()
    {
        var existing = GetSpanId();
        if (!string.IsNullOrEmpty(existing))
        {
            return existing;
        }

        var newId = Guid.NewGuid().ToString("N").Substring(0, 16);
        SetSpanId(newId);
        return newId;
    }
}