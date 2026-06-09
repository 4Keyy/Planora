using Planora.Realtime.Application.Requests;
using Planora.Realtime.Application.Interfaces;
using Planora.BuildingBlocks.Infrastructure.Logging;

namespace Planora.Realtime.Api.Controllers
{
    [ApiController]
    [Route("api/v1/[controller]")]
    [Authorize]
    [Produces("application/json")]
    public sealed class NotificationsController : ControllerBase
    {
        private readonly INotificationService _notificationService;
        private readonly ILogger<NotificationsController> _logger;

        // SECURITY: only server-defined notification types are allowed to prevent
        // client-controlled strings from being injected into connected sessions.
        private static readonly IReadOnlySet<string> AllowedNotificationTypes =
            new HashSet<string>(StringComparer.OrdinalIgnoreCase)
            {
                "info", "success", "warning", "error",
                "TodoCreated", "TodoUpdated", "TodoDeleted",
                "FriendRequest", "FriendAccepted",
                "PasswordChanged", "AccountLocked",
            };

        public NotificationsController(
            INotificationService notificationService,
            ILogger<NotificationsController> logger)
        {
            _notificationService = notificationService;
            _logger = logger;
        }

        [HttpPost("send")]
        [ProducesResponseType(StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status400BadRequest)]
        public async Task<IActionResult> SendNotification(
            [FromBody] SendNotificationRequest request)
        {
            var userId = User.FindFirst("sub")?.Value;

            if (string.IsNullOrEmpty(userId))
            {
                return Unauthorized(new { error = "USER_NOT_AUTHENTICATED" });
            }

            if (!AllowedNotificationTypes.Contains(request.Type ?? string.Empty))
            {
                _logger.LogWarning(
                    "User {UserId} supplied an invalid notification type '{Type}'",
                    userId,
                    LogSanitizer.Clean(request.Type)); // cs/log-forging: client-supplied
                return BadRequest(new { error = "INVALID_NOTIFICATION_TYPE" });
            }

            await _notificationService.SendNotificationAsync(
                userId,
                request.Message,
                request.Type!);

            _logger.LogInformation(
                "Notification sent to user {UserId}: {Message}",
                userId,
                LogSanitizer.Clean(request.Message)); // cs/log-forging: client-supplied

            return Ok(new { success = true, message = "Notification sent" });
        }

        [HttpPost("broadcast")]
        [Authorize(Roles = "Admin")]
        [ProducesResponseType(StatusCodes.Status200OK)]
        public async Task<IActionResult> BroadcastNotification(
            [FromBody] BroadcastNotificationRequest request)
        {
            await _notificationService.SendToAllAsync(
                request.Message,
                request.Type);

            _logger.LogInformation(
                "Broadcast notification sent: {Message}",
                LogSanitizer.Clean(request.Message)); // cs/log-forging: client-supplied

            return Ok(new { success = true, message = "Broadcast sent" });
        }
    }
}
