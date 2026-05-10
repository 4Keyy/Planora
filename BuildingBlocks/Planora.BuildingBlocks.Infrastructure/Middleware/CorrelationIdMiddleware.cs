using Planora.BuildingBlocks.Infrastructure.Logging;

namespace Planora.BuildingBlocks.Infrastructure.Middleware;

/// <summary>
/// Middleware for setting correlation ID and span ID for distributed tracing.
/// </summary>
public class CorrelationIdMiddleware
{
    private readonly RequestDelegate _next;
    private readonly ILogger<CorrelationIdMiddleware> _logger;

    public CorrelationIdMiddleware(RequestDelegate next, ILogger<CorrelationIdMiddleware> logger)
    {
        _next = next;
        _logger = logger;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        // Get or generate correlation ID
        var correlationId = context.Request.Headers["X-Correlation-ID"].FirstOrDefault()
            ?? CorrelationIdContext.GetOrGenerateCorrelationId();

        CorrelationIdContext.SetCorrelationId(correlationId);
        SpanIdContext.SetSpanId(SpanIdContext.GetOrGenerateSpanId());

        // Add to response headers
        context.Response.Headers["X-Correlation-ID"] = correlationId;

        // Set operation from request path
        var operation = GetOperationFromPath(context.Request.Path);
        OperationContext.SetOperation(operation);

        // Log incoming request
        _logger.LogInformation("HTTP {Method} {Path} started",
            context.Request.Method,
            context.Request.Path);

        await _next(context);

        // Log response
        _logger.LogInformation("HTTP {Method} {Path} completed with {StatusCode}",
            context.Request.Method,
            context.Request.Path,
            context.Response.StatusCode);
    }

    private string GetOperationFromPath(PathString path)
    {
        var pathValue = path.Value?.TrimStart('/');
        if (string.IsNullOrEmpty(pathValue))
            return "Unknown";

        // Extract operation from path, e.g., /api/users -> users
        var segments = pathValue.Split('/', StringSplitOptions.RemoveEmptyEntries);
        return segments.Length > 1 ? segments[1] : segments.FirstOrDefault() ?? "Unknown";
    }
}

/// <summary>
/// Extension methods for adding correlation ID middleware.
/// </summary>
public static class CorrelationIdMiddlewareExtensions
{
    public static IApplicationBuilder UseCorrelationId(this IApplicationBuilder builder)
    {
        return builder.UseMiddleware<CorrelationIdMiddleware>();
    }
}