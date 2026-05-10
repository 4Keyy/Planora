namespace Planora.BuildingBlocks.Infrastructure.Logging;

/// <summary>
/// Context for storing operation name across async operations.
/// </summary>
public static class OperationContext
{
    private static readonly AsyncLocal<string?> _operation = new();

    /// <summary>
    /// Gets the current operation.
    /// </summary>
    public static string? GetOperation() => _operation.Value;

    /// <summary>
    /// Sets the operation for the current async context.
    /// </summary>
    public static void SetOperation(string operation)
    {
        _operation.Value = operation;
    }
}