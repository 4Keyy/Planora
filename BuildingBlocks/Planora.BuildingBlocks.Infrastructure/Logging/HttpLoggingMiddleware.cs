using System.Diagnostics;
using System.Text;

namespace Planora.BuildingBlocks.Infrastructure.Logging;

/// <summary>
/// Enterprise-grade HTTP request/response logging middleware with:
/// - Performance metrics
/// - Sensitive data sanitization
/// - Correlation tracking
/// - Structured logging
/// </summary>
public sealed class HttpLoggingMiddleware
{
    private readonly RequestDelegate _next;
    private readonly ILogger<HttpLoggingMiddleware> _logger;

    private static readonly HashSet<string> SensitiveHeaders = new(StringComparer.OrdinalIgnoreCase)
    {
        "Authorization", "Cookie", "Set-Cookie", "X-API-Key", "X-Auth-Token"
    };

    private static readonly HashSet<string> SensitiveQueryParams = new(StringComparer.OrdinalIgnoreCase)
    {
        "password", "token", "apikey", "api_key", "secret", "access_token", "refresh_token"
    };

    public HttpLoggingMiddleware(RequestDelegate next, ILogger<HttpLoggingMiddleware> logger)
    {
        _next = next ?? throw new ArgumentNullException(nameof(next));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
    }

    public async Task InvokeAsync(HttpContext context)
    {
        var stopwatch = Stopwatch.StartNew();
        var correlationId = context.TraceIdentifier;

        // Store correlation ID for enrichers
        context.Items["CorrelationId"] = correlationId;

        // Skip body buffering for gRPC requests (they use streaming)
        if (context.Request.ContentType?.Contains("application/grpc") == true)
        {
            LogRequest(context, correlationId);
            await _next(context);
            stopwatch.Stop();
            _logger.LogInformation(
                "📤 gRPC Response | Method: {Method} | Path: {Path} | StatusCode: {StatusCode} | ElapsedMs: {ElapsedMs} | CorrelationId: {CorrelationId}",
                context.Request.Method, context.Request.Path, context.Response.StatusCode, stopwatch.ElapsedMilliseconds, correlationId);
            return;
        }

        // Log incoming request
        LogRequest(context, correlationId);

        // Capture response details
        var originalBodyStream = context.Response.Body;
        using var responseBody = new MemoryStream();
        context.Response.Body = responseBody;

        Exception? thrownException = null;

        try
        {
            await _next(context);
        }
        catch (Exception ex)
        {
            thrownException = ex;
            throw;
        }
        finally
        {
            stopwatch.Stop();

            // Log response
            await LogResponseAsync(context, correlationId, stopwatch.ElapsedMilliseconds, thrownException);

            // Copy response back to original stream
            responseBody.Seek(0, SeekOrigin.Begin);
            await responseBody.CopyToAsync(originalBodyStream);
        }
    }

    private void LogRequest(HttpContext context, string correlationId)
    {
        var request = context.Request;
        var userId = context.User?.FindFirst("sub")?.Value ?? "Anonymous";

        var sanitizedPath = SanitizeQueryString(request.Path.ToString(), request.QueryString.ToString());
        var method = request.Method;
        var contentType = request.ContentType ?? "N/A";
        var contentLength = request.ContentLength ?? 0;
        var userAgent = request.Headers["User-Agent"].ToString();
        var clientIp = context.Connection.RemoteIpAddress?.ToString() ?? "Unknown";

        _logger.LogInformation(
            "📥 HTTP Request | Method: {Method} | Path: {Path} | ContentType: {ContentType} | ContentLength: {ContentLength} | UserId: {UserId} | ClientIP: {ClientIp} | UserAgent: {UserAgent} | CorrelationId: {CorrelationId}",
            method, sanitizedPath, contentType, contentLength, userId, clientIp, userAgent, correlationId);
    }

    private Task LogResponseAsync(
        HttpContext context,
        string correlationId,
        long elapsedMs,
        Exception? exception)
    {
        var response = context.Response;
        var statusCode = response.StatusCode;
        var contentLength = response.Body.Length;
        var userId = context.User?.FindFirst("sub")?.Value ?? "Anonymous";

        var level = DetermineLogLevel(statusCode, elapsedMs, exception);

        var sanitizedPath = SanitizeQueryString(context.Request.Path.ToString(), context.Request.QueryString.ToString());

        _logger.Log(
            level,
            exception,
            "📤 HTTP Response | Method: {Method} | Path: {Path} | StatusCode: {StatusCode} | ElapsedMs: {ElapsedMs} | ResponseSize: {ResponseSize} | UserId: {UserId} | CorrelationId: {CorrelationId}",
            context.Request.Method, sanitizedPath, statusCode, elapsedMs, contentLength, userId, correlationId);

        // Performance warning for slow requests
        if (elapsedMs > 3000 && exception == null)
        {
            _logger.LogWarning(
                "⚠️ SLOW REQUEST | Method: {Method} | Path: {Path} | ElapsedMs: {ElapsedMs} | CorrelationId: {CorrelationId}",
                context.Request.Method, sanitizedPath, elapsedMs, correlationId);
        }

        return Task.CompletedTask;
    }

    private static LogLevel DetermineLogLevel(int statusCode, long elapsedMs, Exception? exception)
    {
        if (exception != null)
            return LogLevel.Error;

        if (statusCode >= 500)
            return LogLevel.Error;

        if (statusCode >= 400)
            return LogLevel.Warning;

        if (elapsedMs > 3000)
            return LogLevel.Warning;

        return LogLevel.Information;
    }

    private static string SanitizeQueryString(string path, string queryString)
    {
        if (string.IsNullOrEmpty(queryString) || queryString == "?")
            return path;

        var sanitized = new StringBuilder(path);
        sanitized.Append('?');

        var parameters = queryString.TrimStart('?').Split('&');
        var first = true;

        foreach (var param in parameters)
        {
            if (!first)
                sanitized.Append('&');

            var parts = param.Split('=', 2);
            var key = parts[0];
            var value = parts.Length > 1 ? parts[1] : string.Empty;

            sanitized.Append(key);
            sanitized.Append('=');

            // Sanitize sensitive parameters
            if (SensitiveQueryParams.Contains(key))
            {
                sanitized.Append("***REDACTED***");
            }
            else
            {
                sanitized.Append(value);
            }

            first = false;
        }

        return sanitized.ToString();
    }
}

/// <summary>
/// Extension methods for registering HTTP logging middleware.
/// </summary>
public static class HttpLoggingMiddlewareExtensions
{
    public static IApplicationBuilder UseHttpLogging(this IApplicationBuilder app)
    {
        return app.UseMiddleware<HttpLoggingMiddleware>();
    }
}
