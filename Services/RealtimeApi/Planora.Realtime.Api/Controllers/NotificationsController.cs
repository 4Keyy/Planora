using Planora.Realtime.Application.Requests;
using Planora.Realtime.Application.Interfaces;

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

            await _notificationService.SendNotificationAsync(
                userId,
                request.Message,
                request.Type);

            _logger.LogInformation(
                "Notification sent to user {UserId}: {Message}",
                userId,
                request.Message);

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
                request.Message);

            return Ok(new { success = true, message = "Broadcast sent" });
        }
    }
}
