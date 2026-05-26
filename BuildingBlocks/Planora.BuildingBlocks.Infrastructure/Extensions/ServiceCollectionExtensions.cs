using Microsoft.AspNetCore.RateLimiting;
using Planora.BuildingBlocks.Infrastructure.Filters;
using Planora.BuildingBlocks.Infrastructure.Resilience;
using System.Security.Claims;
using System.Threading.RateLimiting;
using RedisRateLimiting;
using StackExchange.Redis;

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

    /// <summary>
    /// Configures global and named rate-limit policies. When
    /// <c>RateLimiting:Backend</c> is set to <c>Redis</c> (production), policies
    /// are backed by a Redis fixed-window limiter so the configured limits are
    /// honored across every service instance behind a load balancer. Otherwise
    /// the policies fall back to an in-memory <see cref="FixedWindowRateLimiter"/>
    /// — that path is used by unit/integration tests and by local development
    /// when no shared Redis is available.
    /// </summary>
    public static IServiceCollection AddConfiguredRateLimiting(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        var backend = configuration["RateLimiting:Backend"];
        var useRedis = string.Equals(backend, "Redis", StringComparison.OrdinalIgnoreCase);

        services.AddRateLimiter(options =>
        {
            if (useRedis)
            {
                ConfigureRedisRateLimits(options);
            }
            else
            {
                ConfigureInMemoryRateLimits(options);
            }

            // On rejection, return 429 Too Many Requests with Retry-After header.
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

    private static void ConfigureInMemoryRateLimits(RateLimiterOptions options)
    {
        // Global fallback: 100 requests/min/IP for endpoints without an explicit
        // [EnableRateLimiting] policy. Protects data endpoints that do not carry
        // individual rate-limit attributes.
        options.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(
            context => RateLimitPartition.GetFixedWindowLimiter(
                partitionKey: PartitionKey(context),
                factory: _ => new FixedWindowRateLimiterOptions
                {
                    AutoReplenishment = true,
                    PermitLimit = 100,
                    Window = TimeSpan.FromMinutes(1)
                }));

        AddInMemoryPolicy(options, "auth", 10);
        AddInMemoryPolicy(options, "login", 5);
        AddInMemoryPolicy(options, "register", 3);
        AddInMemoryPolicy(options, "data", 50);
    }

    private static void ConfigureRedisRateLimits(RateLimiterOptions options)
    {
        // Same limits as the in-memory path, but backed by Redis so the per-IP
        // counters are shared across all replicas of every service.
        options.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(
            context => RedisRateLimitPartition.GetFixedWindowRateLimiter(
                partitionKey: $"planora:rl:global:{PartitionKey(context)}",
                factory: _ => RedisOptions(context, permitLimit: 100)));

        AddRedisPolicy(options, "auth", 10, "planora:rl:auth");
        AddRedisPolicy(options, "login", 5, "planora:rl:login");
        AddRedisPolicy(options, "register", 3, "planora:rl:register");
        AddRedisPolicy(options, "data", 50, "planora:rl:data");
    }

    private static void AddInMemoryPolicy(RateLimiterOptions options, string name, int permitLimit) =>
        options.AddPolicy(name, context =>
            RateLimitPartition.GetFixedWindowLimiter(
                partitionKey: PartitionKey(context),
                factory: _ => new FixedWindowRateLimiterOptions
                {
                    AutoReplenishment = true,
                    PermitLimit = permitLimit,
                    Window = TimeSpan.FromMinutes(1)
                }));

    private static void AddRedisPolicy(RateLimiterOptions options, string name, int permitLimit, string keyPrefix) =>
        options.AddPolicy(name, context =>
            RedisRateLimitPartition.GetFixedWindowRateLimiter(
                partitionKey: $"{keyPrefix}:{PartitionKey(context)}",
                factory: _ => RedisOptions(context, permitLimit)));

    private static RedisFixedWindowRateLimiterOptions RedisOptions(HttpContext context, int permitLimit)
    {
        // Resolve the singleton multiplexer once per partition. The partition is
        // cached by the rate-limiter middleware so this lookup runs at most once
        // per unique partition key, not per request.
        var muxer = context.RequestServices.GetRequiredService<IConnectionMultiplexer>();
        return new RedisFixedWindowRateLimiterOptions
        {
            ConnectionMultiplexerFactory = () => muxer,
            PermitLimit = permitLimit,
            Window = TimeSpan.FromMinutes(1),
        };
    }

    /// <summary>
    /// Resolves the rate-limit partition key for the current request.
    /// </summary>
    /// <remarks>
    /// Precedence:
    /// <list type="number">
    /// <item><description>
    /// Authenticated user id (from the JWT <c>sub</c> or <see cref="ClaimTypes.NameIdentifier"/>
    /// claim) when present. Without this, every user behind a shared NAT — corporate proxy,
    /// mobile carrier CGN, household router — collapses into one bucket and starves each
    /// other under the configured limits.
    /// </description></item>
    /// <item><description>
    /// Remote IP address as the fallback for anonymous traffic (login, register, refresh
    /// before the token exists). Prefixed with <c>ip:</c> so the user/ip namespaces cannot
    /// collide in the Redis key space.
    /// </description></item>
    /// <item><description>
    /// Literal <c>anon</c> when no remote IP is available — used by test contexts and by
    /// pipelines that ran the request before connection metadata was attached.
    /// </description></item>
    /// </list>
    /// Exposed as <c>public</c> so unit tests can pin the precedence down directly without
    /// reaching through the public rate-limit policy surface. The function is pure — no
    /// side effects — so widening the visibility carries no risk.
    /// </remarks>
    public static string PartitionKey(HttpContext context)
    {
        ArgumentNullException.ThrowIfNull(context);

        var userId = context.User?.FindFirst("sub")?.Value
                     ?? context.User?.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        if (!string.IsNullOrWhiteSpace(userId))
        {
            return $"u:{userId}";
        }

        var ip = context.Connection.RemoteIpAddress?.ToString();
        return string.IsNullOrWhiteSpace(ip) ? "anon" : $"ip:{ip}";
    }
}