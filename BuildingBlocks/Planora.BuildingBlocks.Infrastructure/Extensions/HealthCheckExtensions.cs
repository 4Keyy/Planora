namespace Planora.BuildingBlocks.Infrastructure.Extensions;

public static class HealthCheckExtensions
{
    public static IHealthChecksBuilder AddDefaultHealthChecks(
        this IServiceCollection services,
        IConfiguration configuration,
        string serviceName)
    {
        var healthChecksBuilder = services.AddHealthChecks();

        // For now, just add basic health checks
        // TODO: Add specific health checks when packages are available
        return healthChecksBuilder;
    }

    public static IHealthChecksBuilder AddDatabaseHealthCheck(
        this IHealthChecksBuilder builder,
        string connectionString,
        string name = "database",
        HealthStatus failureStatus = HealthStatus.Unhealthy)
    {
        return builder.AddNpgSql(
            connectionString,
            name);
    }
}
