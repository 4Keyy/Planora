using Serilog.Core;
using Serilog.Events;

namespace Planora.BuildingBlocks.Infrastructure.Logging.Enrichers;

/// <summary>
/// Enriches log events with the HTTP request path for request tracking.
/// </summary>
public sealed class RequestPathEnricher : ILogEventEnricher
{
    private readonly IHttpContextAccessor _httpContextAccessor;

    public RequestPathEnricher(IHttpContextAccessor httpContextAccessor)
    {
        _httpContextAccessor = httpContextAccessor ?? throw new ArgumentNullException(nameof(httpContextAccessor));
    }

    public void Enrich(LogEvent logEvent, ILogEventPropertyFactory propertyFactory)
    {
        var requestPath = _httpContextAccessor.HttpContext?.Request?.Path.ToString();

        if (!string.IsNullOrEmpty(requestPath))
        {
            logEvent.AddPropertyIfAbsent(propertyFactory.CreateProperty("RequestPath", requestPath));
        }
    }
}
