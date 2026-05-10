using Serilog.Core;
using Serilog.Events;

namespace Planora.BuildingBlocks.Infrastructure.Logging.Enrichers;

/// <summary>
/// Enriches log events with the service name for distributed tracing.
/// </summary>
public sealed class ServiceNameEnricher : ILogEventEnricher
{
    private readonly string _serviceName;

    public ServiceNameEnricher(string serviceName)
    {
        _serviceName = serviceName ?? throw new ArgumentNullException(nameof(serviceName));
    }

    public void Enrich(LogEvent logEvent, ILogEventPropertyFactory propertyFactory)
    {
        logEvent.AddPropertyIfAbsent(propertyFactory.CreateProperty("ServiceName", _serviceName));
    }
}
