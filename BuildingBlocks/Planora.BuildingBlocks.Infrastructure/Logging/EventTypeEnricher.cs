using Serilog.Core;
using Serilog.Events;

namespace Planora.BuildingBlocks.Infrastructure.Logging;

/// <summary>
/// Enricher for event type.
/// </summary>
public class EventTypeEnricher : ILogEventEnricher
{
    private const string EventTypePropertyName = "EventType";

    public void Enrich(LogEvent logEvent, ILogEventPropertyFactory propertyFactory)
    {
        var eventType = EventTypeContext.GetEventType();
        if (!string.IsNullOrEmpty(eventType))
        {
            logEvent.AddPropertyIfAbsent(propertyFactory.CreateProperty(EventTypePropertyName, eventType));
        }
    }
}