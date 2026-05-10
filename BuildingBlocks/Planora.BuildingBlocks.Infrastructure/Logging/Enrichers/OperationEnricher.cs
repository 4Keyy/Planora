using Serilog.Core;
using Serilog.Events;

namespace Planora.BuildingBlocks.Infrastructure.Logging.Enrichers;

/// <summary>
/// Enriches log events with the current operation name from HttpContext items.
/// Used to track logical operations across middleware and handlers.
/// </summary>
public sealed class OperationEnricher : ILogEventEnricher
{
    private readonly IHttpContextAccessor _httpContextAccessor;

    public OperationEnricher(IHttpContextAccessor httpContextAccessor)
    {
        _httpContextAccessor = httpContextAccessor ?? throw new ArgumentNullException(nameof(httpContextAccessor));
    }

    public void Enrich(LogEvent logEvent, ILogEventPropertyFactory propertyFactory)
    {
        var operation = _httpContextAccessor.HttpContext?.Items["Operation"]?.ToString();

        if (!string.IsNullOrEmpty(operation))
        {
            logEvent.AddPropertyIfAbsent(propertyFactory.CreateProperty("Operation", operation));
        }
    }
}
