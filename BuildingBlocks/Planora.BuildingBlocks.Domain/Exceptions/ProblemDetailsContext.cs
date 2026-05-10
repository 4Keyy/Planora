namespace Planora.BuildingBlocks.Domain.Exceptions;

/// <summary>
/// Enhanced problem details context for unified error responses.
/// Contains all necessary information for structured error handling.
/// </summary>
public sealed class ProblemDetailsContext
{
    public string ErrorCode { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string Detail { get; set; } = string.Empty;
    public int StatusCode { get; set; }
    public string Instance { get; set; } = string.Empty;
    public string TraceId { get; set; } = string.Empty;
    public string? UserId { get; set; }
    public string? ServiceName { get; set; }
    public string? OperationName { get; set; }
    public Dictionary<string, object>? Extensions { get; set; }
    public Dictionary<string, string[]>? ValidationErrors { get; set; }
    public Exception? InnerException { get; set; }
    public long ElapsedMilliseconds { get; set; }

    public void AddExtension(string key, object value)
    {
        Extensions ??= new Dictionary<string, object>();
        Extensions[key] = value;
    }

    public void AddValidationError(string property, params string[] messages)
    {
        ValidationErrors ??= new Dictionary<string, string[]>();
        ValidationErrors[property] = messages;
    }
}

/// <summary>
/// Categorizes exceptions for proper HTTP response mapping.
/// </summary>
public enum ErrorCategory
{
    /// <summary>Client error: Invalid input (400)</summary>
    Validation,

    /// <summary>Client error: Missing or invalid authentication (401)</summary>
    Unauthorized,

    /// <summary>Client error: Insufficient permissions (403)</summary>
    Forbidden,

    /// <summary>Client error: Resource not found (404)</summary>
    NotFound,

    /// <summary>Client error: Business rule violation or conflict (409)</summary>
    Conflict,

    /// <summary>Server error: External service unavailable (503)</summary>
    ServiceUnavailable,

    /// <summary>Server error: Infrastructure failure (500)</summary>
    InternalServer,

    /// <summary>Server error: Unexpected (500)</summary>
    Unexpected
}

/// <summary>
/// Maps error categories to HTTP status codes.
/// </summary>
public static class ErrorCategoryExtensions
{
    public static int GetStatusCode(this ErrorCategory category) => category switch
    {
        ErrorCategory.Validation => 400,
        ErrorCategory.Unauthorized => 401,
        ErrorCategory.Forbidden => 403,
        ErrorCategory.NotFound => 404,
        ErrorCategory.Conflict => 409,
        ErrorCategory.ServiceUnavailable => 503,
        ErrorCategory.InternalServer => 500,
        ErrorCategory.Unexpected => 500,
        _ => 500
    };

    public static string GetTitle(this ErrorCategory category) => category switch
    {
        ErrorCategory.Validation => "Validation Error",
        ErrorCategory.Unauthorized => "Unauthorized",
        ErrorCategory.Forbidden => "Forbidden",
        ErrorCategory.NotFound => "Not Found",
        ErrorCategory.Conflict => "Conflict",
        ErrorCategory.ServiceUnavailable => "Service Unavailable",
        ErrorCategory.InternalServer => "Internal Server Error",
        ErrorCategory.Unexpected => "Unexpected Error",
        _ => "Error"
    };
}
