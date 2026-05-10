using System.Threading.RateLimiting;
using Planora.BuildingBlocks.Domain;
using Planora.BuildingBlocks.Application.Models;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;

namespace Planora.BuildingBlocks.Infrastructure.Middleware;

public sealed class GlobalRateLimitingMiddleware
{
    private readonly RequestDelegate _next;
    private readonly ILogger<GlobalRateLimitingMiddleware> _logger;
    private readonly PartitionedRateLimiter<string> _limiter;

    public GlobalRateLimitingMiddleware(RequestDelegate next, ILogger<GlobalRateLimitingMiddleware> logger)
    {
        _next = next;
        _logger = logger;
        
        _limiter = (PartitionedRateLimiter<string>)PartitionedRateLimiter.Create<string, string>(resource =>
        {
            // Simple fixed window rate limiting per IP or User
            return RateLimitPartition.GetFixedWindowLimiter(
                partitionKey: resource,
                factory: _ => new FixedWindowRateLimiterOptions
                {
                    PermitLimit = 100, // 100 requests
                    Window = TimeSpan.FromMinutes(1), // per minute
                    QueueLimit = 10,
                    QueueProcessingOrder = QueueProcessingOrder.OldestFirst
                });
        });
    }

    public async Task InvokeAsync(HttpContext context)
    {
        var partitionKey = context.User?.FindFirst("sub")?.Value 
                          ?? context.Connection.RemoteIpAddress?.ToString() 
                          ?? "anonymous";

        using var lease = await _limiter.AcquireAsync(partitionKey, 1, context.RequestAborted);

        if (lease.IsAcquired)
        {
            await _next(context);
            return;
        }

        _logger.LogWarning("Rate limit exceeded for {PartitionKey}", partitionKey);

        context.Response.StatusCode = StatusCodes.Status429TooManyRequests;
        
        var domainError = new Planora.BuildingBlocks.Domain.Error("RATE_LIMIT_EXCEEDED", "Too many requests. Please try again later.", Planora.BuildingBlocks.Domain.ErrorType.Failure);
        var response = Planora.BuildingBlocks.Domain.ApiResponse<object>.Failed(domainError, context.TraceIdentifier);
        
        await context.Response.WriteAsJsonAsync(response);
    }
}
