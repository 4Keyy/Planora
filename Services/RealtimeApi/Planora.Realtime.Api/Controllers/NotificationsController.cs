using Planora.Realtime.Application.Requests;
using Planora.Realtime.Application.Interfaces;
using Planora.Realtime.Application.Response;
using Planora.BuildingBlocks.Infrastructure.Logging;

namespace Planora.Realtime.Api.Controllers
{
    [ApiController]
    [Route("api/v1/[controller]")]
    [Authorize]
    [Produces("application/json")]
    public sealed class NotificationsController : ControllerBase
    {
        private const int DefaultPageSize = 30;

        private readonly INotificationService _notificationService;
        private readonly INotificationReadStore _readStore;
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
            INotificationReadStore readStore,
            ILogger<NotificationsController> logger)
        {
            _notificationService = notificationService;
            _readStore = readStore;
            _logger = logger;
        }

        /// <summary>
        /// The compact unread summary (total + per-task breakdown) the client loads on startup and
        /// after each mark-read. Drives every inline indicator: card dots, branch badges, bell count.
        /// </summary>
        [HttpGet("summary")]
        [ProducesResponseType(typeof(NotificationSummary), StatusCodes.Status200OK)]
        public async Task<IActionResult> GetSummary(CancellationToken cancellationToken)
        {
            if (!TryGetUserId(out var userId))
                return Unauthorized(new { error = "USER_NOT_AUTHENTICATED" });

            var summary = await _readStore.GetSummaryAsync(userId, cancellationToken);
            return Ok(summary);
        }

        /// <summary>
        /// A page of the caller's notifications, newest first (the bell dropdown). <paramref name="before"/>
        /// is a keyset cursor (the OccurredOn of the last row seen) for "load older".
        /// </summary>
        [HttpGet]
        [ProducesResponseType(typeof(IReadOnlyList<NotificationPayload>), StatusCodes.Status200OK)]
        public async Task<IActionResult> GetList(
            [FromQuery] int take = DefaultPageSize,
            [FromQuery] DateTime? before = null,
            CancellationToken cancellationToken = default)
        {
            if (!TryGetUserId(out var userId))
                return Unauthorized(new { error = "USER_NOT_AUTHENTICATED" });

            var items = await _readStore.GetListAsync(userId, take, before, cancellationToken);
            return Ok(items);
        }

        /// <summary>
        /// Marks the caller's matching unread notifications read and returns the fresh summary so the
        /// client can reconcile every indicator in one round trip. Scoped to the caller — a user can
        /// only ever mark their own notifications read.
        /// </summary>
        [HttpPost("read")]
        [ProducesResponseType(typeof(NotificationSummary), StatusCodes.Status200OK)]
        public async Task<IActionResult> MarkRead(
            [FromBody] MarkNotificationsReadRequest request,
            CancellationToken cancellationToken)
        {
            if (!TryGetUserId(out var userId))
                return Unauthorized(new { error = "USER_NOT_AUTHENTICATED" });

            var summary = await _readStore.MarkReadAsync(
                userId, request.All, request.TaskId, request.Ids, cancellationToken);
            return Ok(summary);
        }

        /// <summary>Extracts the authenticated user id from the JWT subject claim.</summary>
        private bool TryGetUserId(out Guid userId)
        {
            userId = Guid.Empty;
            var sub = User.FindFirst("sub")?.Value;
            return !string.IsNullOrEmpty(sub) && Guid.TryParse(sub, out userId);
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
