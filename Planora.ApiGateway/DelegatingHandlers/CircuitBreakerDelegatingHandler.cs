using Polly.CircuitBreaker;
using System.Net;
using System.Text.Json;

namespace Planora.ApiGateway.DelegatingHandlers;

/// <summary>
/// Handles circuit breaker exceptions from Ocelot/Polly and returns RFC 7807 ProblemDetails.
/// When downstream service is unavailable and circuit opens, this returns 503 with structured error.
/// </summary>
public sealed class CircuitBreakerDelegatingHandler : DelegatingHandler
{
    private readonly ILogger<CircuitBreakerDelegatingHandler> _logger;

    public CircuitBreakerDelegatingHandler(ILogger<CircuitBreakerDelegatingHandler> logger)
    {
        _logger = logger;
    }

    protected override async Task<HttpResponseMessage> SendAsync(
        HttpRequestMessage request,
        CancellationToken cancellationToken)
    {
        try
        {
            return await base.SendAsync(request, cancellationToken);
        }
        catch (BrokenCircuitException ex)
        {
            // Circuit breaker opened due to downstream service failures
            var correlationId = request.Headers.TryGetValues("X-Correlation-ID", out var values)
                ? values.FirstOrDefault() ?? Guid.NewGuid().ToString()
                : Guid.NewGuid().ToString();

            _logger.LogError(
                ex,
                "🚨 Circuit Breaker Opened | Service: {Service} | Path: {Path} | CorrelationId: {CorrelationId}",
                request.RequestUri?.Host ?? "Unknown",
                request.RequestUri?.PathAndQuery ?? "Unknown",
                correlationId);

            return CreateServiceUnavailableResponse(request, correlationId, ex.Message);
        }
        catch (HttpRequestException ex) when (ex.InnerException is TimeoutException)
        {
            // Request timeout
            var correlationId = request.Headers.TryGetValues("X-Correlation-ID", out var values)
                ? values.FirstOrDefault() ?? Guid.NewGuid().ToString()
                : Guid.NewGuid().ToString();

            _logger.LogError(
                ex,
                "⏱️ Request Timeout | Service: {Service} | Path: {Path} | CorrelationId: {CorrelationId}",
                request.RequestUri?.Host ?? "Unknown",
                request.RequestUri?.PathAndQuery ?? "Unknown",
                correlationId);

            return CreateServiceUnavailableResponse(request, correlationId, "Request timeout - downstream service did not respond in time");
        }
        catch (TaskCanceledException ex) when (!cancellationToken.IsCancellationRequested)
        {
            // Timeout (not user-cancelled)
            var correlationId = request.Headers.TryGetValues("X-Correlation-ID", out var values)
                ? values.FirstOrDefault() ?? Guid.NewGuid().ToString()
                : Guid.NewGuid().ToString();

            _logger.LogError(
                ex,
                "⏱️ Request Timeout (Cancelled) | Service: {Service} | Path: {Path} | CorrelationId: {CorrelationId}",
                request.RequestUri?.Host ?? "Unknown",
                request.RequestUri?.PathAndQuery ?? "Unknown",
                correlationId);

            return CreateServiceUnavailableResponse(request, correlationId, "Request timeout - downstream service did not respond in time");
        }
    }

    private static HttpResponseMessage CreateServiceUnavailableResponse(
        HttpRequestMessage request,
        string correlationId,
        string detail)
    {
        var problemDetails = new
        {
            type = "https://tools.ietf.org/html/rfc7231#section-6.6.4",
            title = "Service Unavailable",
            status = 503,
            detail = detail,
            instance = $"{request.Method} {request.RequestUri?.PathAndQuery ?? "/"}",
            code = "INFRASTRUCTURE.SERVICE_UNAVAILABLE",
            traceId = correlationId,
            timestamp = DateTime.UtcNow
        };

        var response = new HttpResponseMessage(HttpStatusCode.ServiceUnavailable)
        {
            Content = new StringContent(
                JsonSerializer.Serialize(problemDetails, new JsonSerializerOptions
                {
                    PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
                    WriteIndented = false
                }),
                System.Text.Encoding.UTF8,
                "application/problem+json")
        };

        response.Headers.Add("X-Correlation-ID", correlationId);

        return response;
    }
}
