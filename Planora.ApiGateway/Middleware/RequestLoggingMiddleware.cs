using System.Diagnostics;

namespace Planora.ApiGateway.Middleware;

public sealed class RequestLoggingMiddleware
{
    private readonly RequestDelegate _next;
    private readonly ILogger<RequestLoggingMiddleware> _logger;

    public RequestLoggingMiddleware(
        RequestDelegate next,
        ILogger<RequestLoggingMiddleware> logger)
    {
        _next = next;
        _logger = logger;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        var stopwatch = Stopwatch.StartNew();
        var correlationId = context.Items["X-Correlation-ID"]?.ToString() ?? "unknown";

        var requestPath = context.Request.Path;
        var requestMethod = context.Request.Method;
        var userAgent = context.Request.Headers["User-Agent"].ToString();
        var ipAddress = context.Connection.RemoteIpAddress?.ToString() ?? "unknown";

        _logger.LogInformation(
            "Incoming request: {Method} {Path} | CorrelationId: {CorrelationId} | IP: {IpAddress} | UserAgent: {UserAgent}",
            requestMethod,
            requestPath,
            correlationId,
            ipAddress,
            userAgent);

        try
        {
            await _next(context);
            stopwatch.Stop();

            var statusCode = context.Response.StatusCode;
            var logLevel = statusCode >= 500 ? LogLevel.Error :
                          statusCode >= 400 ? LogLevel.Warning :
                          LogLevel.Information;

            _logger.Log(
                logLevel,
                "Request completed: {Method} {Path} | Status: {StatusCode} | Duration: {Duration}ms | CorrelationId: {CorrelationId}",
                requestMethod,
                requestPath,
                statusCode,
                stopwatch.ElapsedMilliseconds,
                correlationId);
        }
        catch (Exception ex)
        {
            stopwatch.Stop();
            _logger.LogError(
                ex,
                "Request failed: {Method} {Path} | Duration: {Duration}ms | CorrelationId: {CorrelationId}",
                requestMethod,
                requestPath,
                stopwatch.ElapsedMilliseconds,
                correlationId);
            throw;
        }
    }
}
