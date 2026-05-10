using System.Diagnostics;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Http;

namespace Planora.BuildingBlocks.Application.Behaviors;

/// <summary>
/// Enterprise-grade MediatR logging behavior with:
/// - Structured logging of CQRS commands/queries
/// - Performance metrics and SLA monitoring
/// - Request/response context capturing
/// - Error tracking with full context
/// </summary>
public sealed class LoggingBehavior<TRequest, TResponse> : IPipelineBehavior<TRequest, TResponse>
    where TRequest : notnull
{
    private readonly ILogger<LoggingBehavior<TRequest, TResponse>> _logger;
    private readonly IHttpContextAccessor? _httpContextAccessor;

    public LoggingBehavior(
        ILogger<LoggingBehavior<TRequest, TResponse>> logger,
        IHttpContextAccessor? httpContextAccessor = null)
    {
        _logger = logger;
        _httpContextAccessor = httpContextAccessor;
    }

    public async Task<TResponse> Handle(
        TRequest request,
        RequestHandlerDelegate<TResponse> next,
        CancellationToken cancellationToken)
    {
        var requestName = typeof(TRequest).Name;
        var requestType = DetermineRequestType(requestName);
        var correlationId = _httpContextAccessor?.HttpContext?.TraceIdentifier ?? Guid.NewGuid().ToString();
        var userId = _httpContextAccessor?.HttpContext?.User?.FindFirst("sub")?.Value ?? "System";

        // Set operation context for enrichers
        if (_httpContextAccessor?.HttpContext != null)
        {
            _httpContextAccessor.HttpContext.Items["Operation"] = requestName;
        }

        // Log request start with structured data
        _logger.LogInformation(
            "🎯 {RequestType} Started | Name: {RequestName} | UserId: {UserId} | CorrelationId: {CorrelationId} | Request: {@Request}",
            requestType, requestName, userId, correlationId, SanitizeRequest(request));

        var stopwatch = Stopwatch.StartNew();
        TResponse? response = default;
        Exception? caughtException = null;

        try
        {
            response = await next();
            stopwatch.Stop();

            // Determine log level based on performance
            var logLevel = stopwatch.ElapsedMilliseconds > 2000 ? LogLevel.Warning : LogLevel.Information;
            var emoji = stopwatch.ElapsedMilliseconds > 2000 ? "⚠️" : "✅";

            _logger.Log(
                logLevel,
                "{Emoji} {RequestType} Completed | Name: {RequestName} | ElapsedMs: {ElapsedMs} | UserId: {UserId} | CorrelationId: {CorrelationId} | Response: {@Response}",
                emoji, requestType, requestName, stopwatch.ElapsedMilliseconds, userId, correlationId, SanitizeResponse(response));

            // Performance SLA warnings
            if (stopwatch.ElapsedMilliseconds > 5000)
            {
                _logger.LogWarning(
                    "🐌 PERFORMANCE SLA BREACH | {RequestType}: {RequestName} | ElapsedMs: {ElapsedMs} | Threshold: 5000ms | UserId: {UserId} | CorrelationId: {CorrelationId}",
                    requestType, requestName, stopwatch.ElapsedMilliseconds, userId, correlationId);
            }

            return response;
        }
        catch (Exception ex)
        {
            stopwatch.Stop();
            caughtException = ex;

            _logger.LogError(
                ex,
                "❌ {RequestType} Failed | Name: {RequestName} | ElapsedMs: {ElapsedMs} | UserId: {UserId} | CorrelationId: {CorrelationId} | ErrorType: {ErrorType} | Request: {@Request}",
                requestType, requestName, stopwatch.ElapsedMilliseconds, userId, correlationId, ex.GetType().Name, SanitizeRequest(request));

            throw;
        }
    }

    private static string DetermineRequestType(string requestName)
    {
        if (requestName.EndsWith("Command", StringComparison.OrdinalIgnoreCase))
            return "Command";
        
        if (requestName.EndsWith("Query", StringComparison.OrdinalIgnoreCase))
            return "Query";
        
        return "Request";
    }

    private static object SanitizeRequest(TRequest request)
        => SanitizeObject(request, typeof(TRequest).Name);

    private static object SanitizeResponse(TResponse? response)
    {
        if (response == null)
            return "null";

        return SanitizeObject(response, typeof(TResponse).Name);
    }

    private static object SanitizeObject<T>(T value, string fallback)
    {
        try
        {
            var json = JsonSerializer.Serialize(value, new JsonSerializerOptions
            {
                WriteIndented = false,
                PropertyNamingPolicy = JsonNamingPolicy.CamelCase
            });

            var node = JsonNode.Parse(json);
            RedactSensitiveValues(node);
            return node ?? fallback;
        }
        catch
        {
            return fallback;
        }
    }

    private static void RedactSensitiveValues(JsonNode? node)
    {
        switch (node)
        {
            case JsonObject obj:
                foreach (var propertyName in obj.Select(property => property.Key).ToList())
                {
                    if (IsSensitiveProperty(propertyName))
                    {
                        obj[propertyName] = "***REDACTED***";
                    }
                    else
                    {
                        RedactSensitiveValues(obj[propertyName]);
                    }
                }
                break;

            case JsonArray array:
                foreach (var item in array)
                    RedactSensitiveValues(item);
                break;
        }
    }

    private static bool IsSensitiveProperty(string propertyName) =>
        propertyName.Contains("password", StringComparison.OrdinalIgnoreCase) ||
        propertyName.Contains("token", StringComparison.OrdinalIgnoreCase) ||
        propertyName.Contains("secret", StringComparison.OrdinalIgnoreCase) ||
        propertyName.Contains("apiKey", StringComparison.OrdinalIgnoreCase);
}
