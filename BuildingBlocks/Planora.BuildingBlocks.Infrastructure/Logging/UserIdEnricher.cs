using Serilog.Core;
using Serilog.Events;
using System.Security.Claims;

namespace Planora.BuildingBlocks.Infrastructure.Logging;

/// <summary>
/// Enricher for user ID from HTTP context.
/// </summary>
public class UserIdEnricher : ILogEventEnricher
{
    private const string UserIdPropertyName = "UserId";

    public void Enrich(LogEvent logEvent, ILogEventPropertyFactory propertyFactory)
    {
        // This would need to be implemented based on how user context is stored
        // For now, we'll assume it's available via some service or context
        var userId = GetCurrentUserId();
        if (!string.IsNullOrEmpty(userId))
        {
            logEvent.AddPropertyIfAbsent(propertyFactory.CreateProperty(UserIdPropertyName, userId));
        }
    }

    private string? GetCurrentUserId()
    {
        // This should be injected or accessed from current context
        // For simplicity, return null for now - will be implemented per service
        return null;
    }
}