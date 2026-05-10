using Serilog.Core;
using Serilog.Events;

namespace Planora.BuildingBlocks.Infrastructure.Logging;

/// <summary>
/// Enricher for operation name.
/// </summary>
public class OperationEnricher : ILogEventEnricher
{
    private const string OperationPropertyName = "Operation";

    public void Enrich(LogEvent logEvent, ILogEventPropertyFactory propertyFactory)
    {
        var operation = OperationContext.GetOperation();
        if (!string.IsNullOrEmpty(operation))
        {
            logEvent.AddPropertyIfAbsent(propertyFactory.CreateProperty(OperationPropertyName, operation));
        }
    }
}