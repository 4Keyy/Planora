using Serilog.Core;
using Serilog.Events;

namespace Planora.BuildingBlocks.Infrastructure.Logging.Enrichers;

/// <summary>
/// Enriches log events with event type for structured business event logging.
/// Event type is set in HttpContext items by handlers/middleware.
/// </summary>
public sealed class EventTypeEnricher : ILogEventEnricher
{
    private readonly IHttpContextAccessor _httpContextAccessor;

    public EventTypeEnricher(IHttpContextAccessor httpContextAccessor)
    {
        _httpContextAccessor = httpContextAccessor ?? throw new ArgumentNullException(nameof(httpContextAccessor));
    }

    public void Enrich(LogEvent logEvent, ILogEventPropertyFactory propertyFactory)
    {
        var eventType = _httpContextAccessor.HttpContext?.Items["EventType"]?.ToString();

        if (!string.IsNullOrEmpty(eventType))
        {
            logEvent.AddPropertyIfAbsent(propertyFactory.CreateProperty("EventType", eventType));
        }
    }
}
