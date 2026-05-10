using Serilog.Core;
using Serilog.Events;
using System.Diagnostics;

namespace Planora.BuildingBlocks.Infrastructure.Logging;

/// <summary>
/// Enricher for correlation ID from HTTP context or async local.
/// </summary>
public class CorrelationIdEnricher : ILogEventEnricher
{
    private const string CorrelationIdPropertyName = "TraceId";

    public void Enrich(LogEvent logEvent, ILogEventPropertyFactory propertyFactory)
    {
        var correlationId = Activity.Current?.TraceId.ToHexString() ?? CorrelationIdContext.GetCorrelationId();
        if (!string.IsNullOrEmpty(correlationId))
        {
            logEvent.AddPropertyIfAbsent(propertyFactory.CreateProperty(CorrelationIdPropertyName, correlationId));
        }
    }
}