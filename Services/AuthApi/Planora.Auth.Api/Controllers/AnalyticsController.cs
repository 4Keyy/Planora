using System.Text.Json;
using Planora.BuildingBlocks.Application.Services;

namespace Planora.Auth.Api.Controllers;

[ApiController]
[Route("api/v1/[controller]")]
[Authorize]
[Produces("application/json")]
[ProducesResponseType(StatusCodes.Status401Unauthorized)]
[ProducesResponseType(StatusCodes.Status403Forbidden)]
public sealed class AnalyticsController : ControllerBase
{
    private const int MaxPropertiesBytes = 4096;

    private readonly IBusinessEventLogger _businessLogger;
    private readonly ICurrentUserService _currentUserService;

    public AnalyticsController(
        IBusinessEventLogger businessLogger,
        ICurrentUserService currentUserService)
    {
        _businessLogger = businessLogger;
        _currentUserService = currentUserService;
    }

    [HttpPost("events")]
    [ProducesResponseType(StatusCodes.Status202Accepted)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public IActionResult TrackEvent([FromBody] TrackAnalyticsEventRequest request)
    {
        var eventName = request.EventName.Trim();
        if (string.IsNullOrWhiteSpace(eventName))
        {
            return BadRequest(new { error = "EVENT_NAME_REQUIRED" });
        }

        if (!BusinessEvents.IsAllowedProductEvent(eventName))
        {
            return BadRequest(new { error = "UNKNOWN_ANALYTICS_EVENT" });
        }

        string? propertiesJson = null;
        if (request.Properties.HasValue && request.Properties.Value.ValueKind != JsonValueKind.Null)
        {
            if (request.Properties.Value.ValueKind != JsonValueKind.Object)
            {
                return BadRequest(new { error = "INVALID_PROPERTIES" });
            }

            propertiesJson = request.Properties.Value.GetRawText();
            if (Encoding.UTF8.GetByteCount(propertiesJson) > MaxPropertiesBytes)
            {
                return BadRequest(new { error = "PROPERTIES_TOO_LARGE" });
            }
        }

        var userId = _currentUserService.UserId?.ToString();
        _businessLogger.LogBusinessEvent(
            eventName,
            $"Frontend analytics event {eventName}",
            new
            {
                Source = "Frontend",
                OccurredAt = request.OccurredAt?.UtcDateTime ?? DateTime.UtcNow,
                PropertiesJson = propertiesJson
            },
            userId);

        return Accepted();
    }
}

public sealed record TrackAnalyticsEventRequest
{
    public string EventName { get; init; } = string.Empty;
    public JsonElement? Properties { get; init; }
    public DateTimeOffset? OccurredAt { get; init; }
}
