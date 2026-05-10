using Planora.BuildingBlocks.Infrastructure.Messaging;
using Microsoft.Extensions.Diagnostics.HealthChecks;

namespace Planora.Auth.Infrastructure.HealthChecks;

public sealed class RabbitMqHealthCheck : IHealthCheck
{
    private readonly IRabbitMqConnectionManager _connectionManager;

    public RabbitMqHealthCheck(IRabbitMqConnectionManager connectionManager)
    {
        _connectionManager = connectionManager;
    }

    public async Task<HealthCheckResult> CheckHealthAsync(HealthCheckContext context, CancellationToken cancellationToken = default)
    {
        try
        {
            var conn = await _connectionManager.GetConnectionAsync(cancellationToken);
            var isOpen = conn is not null && conn.IsOpen;
            return isOpen
                ? HealthCheckResult.Healthy("RabbitMQ connected")
                : HealthCheckResult.Degraded("RabbitMQ not connected");
        }
        catch (Exception ex)
        {
            return HealthCheckResult.Degraded("RabbitMQ connection failed: " + ex.Message);
        }
    }
}
