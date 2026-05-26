using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Microsoft.AspNetCore.Routing;

namespace Planora.BuildingBlocks.Infrastructure.Extensions;

/// <summary>
/// Centralizes health-check wiring so every Planora service exposes the same
/// probe surface: <c>/health/live</c> for process liveness, <c>/health/ready</c>
/// for readiness (dependencies wired and reachable), and <c>/health</c> as a
/// backwards-compatible aggregate for existing docker-compose consumers.
/// </summary>
/// <remarks>
/// Tag convention used by the probes:
/// <list type="bullet">
/// <item><description><c>live</c> — checks that must succeed for the process to be considered alive.
/// Use sparingly: kill-and-restart is the response. If no checks carry this tag the endpoint
/// returns <see cref="HealthStatus.Healthy"/> by default (vacuous truth), which is the correct
/// behavior for a process that has booted far enough to serve HTTP.</description></item>
/// <item><description><c>ready</c> — checks that must succeed for the service to accept traffic
/// (database reachable, broker connection established, cache available). Traffic is held off
/// until ready returns 200.</description></item>
/// </list>
/// Both endpoints disable response caching so that load balancers and orchestrators
/// always observe fresh state.
/// </remarks>
public static class HealthCheckExtensions
{
    public const string LiveTag = "live";
    public const string ReadyTag = "ready";

    public static IHealthChecksBuilder AddDefaultHealthChecks(
        this IServiceCollection services,
        IConfiguration configuration,
        string serviceName)
    {
        return services.AddHealthChecks();
    }

    public static IHealthChecksBuilder AddDatabaseHealthCheck(
        this IHealthChecksBuilder builder,
        string connectionString,
        string name = "database",
        HealthStatus failureStatus = HealthStatus.Unhealthy)
    {
        return builder.AddNpgSql(
            connectionString,
            name: name,
            failureStatus: failureStatus,
            tags: new[] { ReadyTag });
    }

    /// <summary>
    /// Maps the three Planora-standard health probes: <c>/health/live</c>, <c>/health/ready</c>,
    /// and the aggregate <c>/health</c>. Call this exactly once per service, in place of any
    /// previous <c>app.MapHealthChecks("/health")</c> registration.
    /// </summary>
    public static IEndpointRouteBuilder MapPlanoraHealthEndpoints(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        endpoints.MapHealthChecks("/health/live", new HealthCheckOptions
        {
            Predicate = check => check.Tags.Contains(LiveTag),
            AllowCachingResponses = false,
        });

        endpoints.MapHealthChecks("/health/ready", new HealthCheckOptions
        {
            Predicate = check => check.Tags.Contains(ReadyTag),
            AllowCachingResponses = false,
        });

        // Backwards compatibility — existing docker-compose healthchecks and any other
        // off-the-shelf consumers continue to point at /health and get the aggregate state
        // of every registered check.
        endpoints.MapHealthChecks("/health", new HealthCheckOptions
        {
            AllowCachingResponses = false,
        });

        return endpoints;
    }
}
