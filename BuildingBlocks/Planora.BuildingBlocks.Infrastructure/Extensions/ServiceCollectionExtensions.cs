using Microsoft.AspNetCore.RateLimiting;
using Planora.BuildingBlocks.Infrastructure.Filters;
using Planora.BuildingBlocks.Infrastructure.Resilience;
using System.Globalization;
using System.Reflection;
using System.Security.Claims;
using System.Threading.RateLimiting;
using Microsoft.Extensions.Hosting;
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

    /// <summary>Requests per minute one partition may send to one service.</summary>
    public const int GlobalPermitsPerMinute = 250;

    /// <summary>Seconds a client is told to wait when a limiter cannot say when its window resets.</summary>
    public const int FallbackRetryAfterSeconds = 60;

    /// <summary>
    /// The named policies, per partition. Credential endpoints stay tight (the Auth service's
    /// account lockout sits behind them too); the rest leave room for ordinary use.
    /// </summary>
    public static IReadOnlyList<(string Name, int PermitLimit, TimeSpan Window)> NamedPolicies { get; } =
    [
        // Refresh, logout, token validation and password reset.
        ("auth", 20, TimeSpan.FromMinutes(1)),
        ("login", 10, TimeSpan.FromMinutes(1)),
        ("register", 6, TimeSpan.FromMinutes(1)),
        ("data", 125, TimeSpan.FromMinutes(1)),
        // Avatars are bytes-on-disk: even after the 5 MB cap and ImageSharp re-encoding, an
        // attacker with a valid token could spin the storage layer. At 10/hour the worst-case
        // write traffic is bounded to ~50 MB/hour/user.
        ("avatar-upload", 10, TimeSpan.FromHours(1)),
        // Anonymous client error reports (Auth's ClientErrorsController): enough for a burst of
        // distinct failures from one page, not enough to flood the logs.
        ("client-errors", 50, TimeSpan.FromMinutes(1)),
    ];

    /// <summary>
    /// Configures global and named rate-limit policies. When
    /// <c>RateLimiting:Backend</c> is set to <c>Redis</c> (production), policies
    /// are backed by a Redis fixed-window limiter so the configured limits are
    /// honored across every service instance behind a load balancer. Otherwise
    /// the policies fall back to an in-memory <see cref="FixedWindowRateLimiter"/>
    /// — that path is used by unit/integration tests and by local development
    /// when no shared Redis is available.
    /// </summary>
    /// <remarks>
    /// The partition is the signed-in user (<see cref="PartitionKey"/>), so a service must call
    /// <c>UseRateLimiter()</c> AFTER <c>UseAuthentication()</c>. Before it, every request looked
    /// anonymous and, behind the gateway, carried the gateway's address: all users shared one
    /// bucket and the app answered 429 after 15–30 seconds of ordinary use.
    /// </remarks>
    public static IServiceCollection AddConfiguredRateLimiting(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        var backend = configuration["RateLimiting:Backend"];
        var useRedis = string.Equals(backend, "Redis", StringComparison.OrdinalIgnoreCase);
        var scope = RateLimitScope(configuration);

        services.AddRateLimiter(options =>
        {
            if (useRedis)
            {
                ConfigureRedisRateLimits(options, scope);
            }
            else
            {
                ConfigureInMemoryRateLimits(options);
            }

            options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
            options.OnRejected = (context, cancellationToken) =>
                WriteRateLimitRejectionAsync(context.HttpContext, context.Lease, cancellationToken);
        });

        return services;
    }

    /// <summary>
    /// Answers a rejected request with 429, a <c>Retry-After</c> header and a JSON body that both
    /// say how many seconds remain until the rejecting window resets. A fixed "60" told a client
    /// that hit the limit in a window's last second to wait a whole minute for nothing.
    /// </summary>
    public static async ValueTask WriteRateLimitRejectionAsync(
        HttpContext httpContext,
        RateLimitLease lease,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(httpContext);
        ArgumentNullException.ThrowIfNull(lease);

        var retryAfter = RetryAfterSeconds(lease);
        httpContext.Response.StatusCode = StatusCodes.Status429TooManyRequests;
        httpContext.Response.Headers.RetryAfter = retryAfter.ToString(CultureInfo.InvariantCulture);
        await httpContext.Response.WriteAsJsonAsync(new
        {
            error = "Too many requests. Please try again later.",
            retryAfter
        }, cancellationToken);
    }

    /// <summary>
    /// Whole seconds until the rejecting window resets, at least 1, from the lease's
    /// <see cref="MetadataName.RetryAfter"/>; <see cref="FallbackRetryAfterSeconds"/> without it.
    /// </summary>
    public static int RetryAfterSeconds(RateLimitLease lease)
    {
        ArgumentNullException.ThrowIfNull(lease);
        if (!lease.TryGetMetadata(MetadataName.RetryAfter, out var retryAfter) || retryAfter <= TimeSpan.Zero)
        {
            return FallbackRetryAfterSeconds;
        }

        return (int)Math.Min(int.MaxValue, Math.Max(1, Math.Ceiling(retryAfter.TotalSeconds)));
    }

    /// <summary>
    /// The service's segment of every Redis rate-limit key: <c>RateLimiting:Scope</c>, else the
    /// application name, lower-cased. Without it the per-user "global" counter was one key shared
    /// by every service, so a user's requests for tasks, categories, friends and notifications
    /// all spent the same allowance.
    /// </summary>
    public static string RateLimitScope(IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(configuration);

        var scope = configuration["RateLimiting:Scope"];
        if (string.IsNullOrWhiteSpace(scope)) scope = configuration[HostDefaults.ApplicationKey];
        if (string.IsNullOrWhiteSpace(scope)) scope = Assembly.GetEntryAssembly()?.GetName().Name;
        return string.IsNullOrWhiteSpace(scope) ? "service" : scope.Trim().ToLowerInvariant();
    }

    private static void ConfigureInMemoryRateLimits(RateLimiterOptions options)
    {
        // Global fallback: GlobalPermitsPerMinute per user (per IP when anonymous) for endpoints
        // without an explicit [EnableRateLimiting] policy. Protects data endpoints that do not
        // carry individual rate-limit attributes.
        options.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(
            context => RateLimitPartition.GetFixedWindowLimiter(
                partitionKey: PartitionKey(context),
                factory: _ => new FixedWindowRateLimiterOptions
                {
                    AutoReplenishment = true,
                    PermitLimit = GlobalPermitsPerMinute,
                    Window = TimeSpan.FromMinutes(1)
                }));

        foreach (var (name, permitLimit, window) in NamedPolicies)
        {
            AddInMemoryPolicy(options, name, permitLimit, window);
        }
    }

    private static void ConfigureRedisRateLimits(RateLimiterOptions options, string scope)
    {
        // Same limits as the in-memory path, but backed by Redis so the counters are shared
        // across all replicas of one service. The scope keeps each service's counters apart.
        options.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(
            context => RedisRateLimitPartition.GetFixedWindowRateLimiter(
                partitionKey: $"planora:rl:{scope}:global:{PartitionKey(context)}",
                factory: _ => RedisOptions(context, permitLimit: GlobalPermitsPerMinute, window: TimeSpan.FromMinutes(1))));

        foreach (var (name, permitLimit, window) in NamedPolicies)
        {
            AddRedisPolicy(options, name, permitLimit, $"planora:rl:{scope}:{name}", window);
        }
    }

    private static void AddInMemoryPolicy(RateLimiterOptions options, string name, int permitLimit, TimeSpan window) =>
        options.AddPolicy(name, context =>
            RateLimitPartition.GetFixedWindowLimiter(
                partitionKey: PartitionKey(context),
                factory: _ => new FixedWindowRateLimiterOptions
                {
                    AutoReplenishment = true,
                    PermitLimit = permitLimit,
                    Window = window
                }));

    private static void AddRedisPolicy(RateLimiterOptions options, string name, int permitLimit, string keyPrefix, TimeSpan window) =>
        options.AddPolicy(name, context =>
            RedisRateLimitPartition.GetFixedWindowRateLimiter(
                partitionKey: $"{keyPrefix}:{PartitionKey(context)}",
                factory: _ => RedisOptions(context, permitLimit, window)));

    private static RedisFixedWindowRateLimiterOptions RedisOptions(HttpContext context, int permitLimit, TimeSpan window)
    {
        // Resolve the singleton multiplexer once per partition. The partition is
        // cached by the rate-limiter middleware so this lookup runs at most once
        // per unique partition key, not per request.
        var muxer = context.RequestServices.GetRequiredService<IConnectionMultiplexer>();
        return new RedisFixedWindowRateLimiterOptions
        {
            ConnectionMultiplexerFactory = () => muxer,
            PermitLimit = permitLimit,
            Window = window,
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

        var address = context.Connection.RemoteIpAddress;
        if (address is null)
        {
            return "anon";
        }

        // Normalize IPv4-mapped IPv6 (::ffff:1.2.3.4) to plain IPv4 so a client that
        // hits the service through different stacks does not get two separate buckets.
        if (address.IsIPv4MappedToIPv6)
        {
            address = address.MapToIPv4();
        }

        return $"ip:{address}";
    }
}