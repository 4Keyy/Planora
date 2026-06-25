using Planora.BuildingBlocks.Infrastructure.Messaging;
using Microsoft.Extensions.Diagnostics.HealthChecks;

namespace Planora.BuildingBlocks.Infrastructure.HealthChecks;

/// <summary>
/// Readiness probe for the RabbitMQ broker, shared by every Planora service that publishes or
/// consumes integration events. It reuses the application's own <see cref="IRabbitMqConnectionManager"/>
/// (the singleton the event bus already holds) rather than opening a throwaway connection, so the
/// probe reflects the exact connection the service depends on.
/// </summary>
/// <remarks>
/// Reported as <see cref="HealthStatus.Degraded"/> rather than <see cref="HealthStatus.Unhealthy"/>:
/// outgoing events are buffered durably in the outbox while the broker is unreachable, so a broker
/// outage must NOT pull the whole instance out of rotation. The check is tagged <c>messaging</c>
/// (not <c>ready</c>/<c>live</c>) so it surfaces on the aggregate <c>/health</c> endpoint for
/// dashboards and operators without gating the readiness/liveness probes.
/// </remarks>
public sealed class RabbitMqHealthCheck : IHealthCheck
{
    private readonly IRabbitMqConnectionManager _connectionManager;

    public RabbitMqHealthCheck(IRabbitMqConnectionManager connectionManager)
    {
        _connectionManager = connectionManager;
    }

    public async Task<HealthCheckResult> CheckHealthAsync(
        HealthCheckContext context,
        CancellationToken cancellationToken = default)
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
