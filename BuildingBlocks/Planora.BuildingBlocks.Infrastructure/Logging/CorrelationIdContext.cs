using System.Threading;

namespace Planora.BuildingBlocks.Infrastructure.Logging;

/// <summary>
/// Context for storing correlation ID across async operations.
/// </summary>
public static class CorrelationIdContext
{
    private static readonly AsyncLocal<string?> _correlationId = new();

    /// <summary>
    /// Gets the current correlation ID.
    /// </summary>
    public static string? GetCorrelationId() => _correlationId.Value;

    /// <summary>
    /// Sets the correlation ID for the current async context.
    /// </summary>
    public static void SetCorrelationId(string correlationId)
    {
        _correlationId.Value = correlationId;
    }

    /// <summary>
    /// Generates a new correlation ID if none exists.
    /// </summary>
    public static string GetOrGenerateCorrelationId()
    {
        var existing = GetCorrelationId();
        if (!string.IsNullOrEmpty(existing))
        {
            return existing;
        }

        var newId = Guid.NewGuid().ToString();
        SetCorrelationId(newId);
        return newId;
    }
}