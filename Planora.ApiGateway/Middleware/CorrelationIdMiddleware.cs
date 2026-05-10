namespace Planora.ApiGateway.Middleware;

public sealed class CorrelationIdMiddleware
{
    private const string CorrelationIdHeaderName = "X-Correlation-ID";
    private const string CorrelationIdLogPropertyName = "CorrelationId";
    private readonly RequestDelegate _next;
    private readonly ILogger<CorrelationIdMiddleware> _logger;

    public CorrelationIdMiddleware(
        RequestDelegate next,
        ILogger<CorrelationIdMiddleware> logger)
    {
        _next = next;
        _logger = logger;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        var correlationId = GetOrGenerateCorrelationId(context);

        // Add to response headers
        context.Response.Headers[CorrelationIdHeaderName] = correlationId;

        // Add to log context
        using (_logger.BeginScope(new Dictionary<string, object>
        {
            [CorrelationIdLogPropertyName] = correlationId
        }))
        {
            // Store in HttpContext.Items for downstream services
            context.Items[CorrelationIdHeaderName] = correlationId;

            // Add to request headers for downstream services
            if (!context.Request.Headers.ContainsKey(CorrelationIdHeaderName))
            {
                context.Request.Headers[CorrelationIdHeaderName] = correlationId;
            }

            await _next(context);
        }
    }

    private static string GetOrGenerateCorrelationId(HttpContext context)
    {
        // Try to get from request headers first
        if (context.Request.Headers.TryGetValue(CorrelationIdHeaderName, out var correlationId) &&
            !string.IsNullOrWhiteSpace(correlationId))
        {
            return correlationId.ToString();
        }

        // Generate new correlation ID
        return Guid.NewGuid().ToString("N");
    }
}
