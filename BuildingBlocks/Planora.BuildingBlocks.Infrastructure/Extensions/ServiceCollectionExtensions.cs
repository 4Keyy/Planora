using Microsoft.AspNetCore.RateLimiting;
using Planora.BuildingBlocks.Infrastructure.Filters;
using Planora.BuildingBlocks.Infrastructure.Resilience;
using System.Threading.RateLimiting;

namespace Planora.BuildingBlocks.Infrastructure.Extensions;

public static class ServiceCollectionExtensions
{
    public static IServiceCollection AddResilientHttpClient(
        this IServiceCollection services,
        string name,
        string baseAddress,
        IConfiguration configuration)
    {
        // Configure a simple HttpClient. Resilience/advanced policies are optional
        // and may not be available in all target environments. Keep this method
        // lightweight to avoid hard dependency on specific resilience libraries.
        services.AddHttpClient(name, client =>
        {
            client.BaseAddress = new Uri(baseAddress);
            client.Timeout = TimeSpan.FromSeconds(30);
        });

        return services;
    }

    public static IServiceCollection AddApiFilters(this IServiceCollection services)
    {
        services.AddScoped<ValidationFilter>();
        return services;
    }

    public static IServiceCollection AddConfiguredResponseCompression(this IServiceCollection services)
    {
        services.AddResponseCompression(options =>
        {
            options.EnableForHttps = true;
        });
        return services;
    }

    public static IServiceCollection AddConfiguredRateLimiting(this IServiceCollection services)
    {
        // Configure rate limiting with multiple policies
        services.AddRateLimiter(options =>
        {
            // Global fallback: 100 requests per minute per IP for all endpoints that do
            // not have an explicit [EnableRateLimiting] policy. This protects data
            // endpoints (todos, categories, messages) that do not carry individual
            // rate-limit attributes. Previously this limiter was commented out, leaving
            // those endpoints completely unthrottled.
            options.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(context =>
                RateLimitPartition.GetFixedWindowLimiter(
                    partitionKey: context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
                    factory: _ => new FixedWindowRateLimiterOptions
                    {
                        AutoReplenishment = true,
                        PermitLimit = 100,
                        Window = TimeSpan.FromMinutes(1)
                    }));

            // Strict limiter for auth endpoints (10 requests per minute per IP)
            options.AddPolicy("auth", context =>
                RateLimitPartition.GetFixedWindowLimiter(
                    partitionKey: context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
                    factory: _ => new FixedWindowRateLimiterOptions
                    {
                        AutoReplenishment = true,
                        PermitLimit = 10,
                        Window = TimeSpan.FromMinutes(1)
                    }));

            // Stricter limiter for login endpoint (5 requests per minute per IP)
            options.AddPolicy("login", context =>
                RateLimitPartition.GetFixedWindowLimiter(
                    partitionKey: context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
                    factory: _ => new FixedWindowRateLimiterOptions
                    {
                        AutoReplenishment = true,
                        PermitLimit = 5,
                        Window = TimeSpan.FromMinutes(1)
                    }));

            // Strict limiter for register endpoint (3 requests per minute per IP)
            options.AddPolicy("register", context =>
                RateLimitPartition.GetFixedWindowLimiter(
                    partitionKey: context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
                    factory: _ => new FixedWindowRateLimiterOptions
                    {
                        AutoReplenishment = true,
                        PermitLimit = 3,
                        Window = TimeSpan.FromMinutes(1)
                    }));

            // Standard limiter for data endpoints (50 requests per minute per IP)
            options.AddPolicy("data", context =>
                RateLimitPartition.GetFixedWindowLimiter(
                    partitionKey: context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
                    factory: _ => new FixedWindowRateLimiterOptions
                    {
                        AutoReplenishment = true,
                        PermitLimit = 50,
                        Window = TimeSpan.FromMinutes(1)
                    }));

            // On rejection, return 429 Too Many Requests with Retry-After header
            options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
            options.OnRejected = async (context, _) =>
            {
                context.HttpContext.Response.StatusCode = StatusCodes.Status429TooManyRequests;
                context.HttpContext.Response.Headers.RetryAfter = "60";
                await context.HttpContext.Response.WriteAsJsonAsync(new
                {
                    error = "Too many requests. Please try again later.",
                    retryAfter = 60
                });
            };
        });

        return services;
    }
}