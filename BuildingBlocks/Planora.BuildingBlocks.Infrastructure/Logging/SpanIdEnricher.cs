using System.Diagnostics;
using Serilog.Core;
using Serilog.Events;

namespace Planora.BuildingBlocks.Infrastructure.Logging;

/// <summary>
/// Enricher for span ID (request ID).
/// </summary>
public class SpanIdEnricher : ILogEventEnricher
{
    private const string SpanIdPropertyName = "SpanId";

    public void Enrich(LogEvent logEvent, ILogEventPropertyFactory propertyFactory)
    {
        var spanId = Activity.Current?.SpanId.ToHexString() ?? SpanIdContext.GetSpanId();
        if (!string.IsNullOrEmpty(spanId))
        {
            logEvent.AddPropertyIfAbsent(propertyFactory.CreateProperty(SpanIdPropertyName, spanId));
        }
    }
}