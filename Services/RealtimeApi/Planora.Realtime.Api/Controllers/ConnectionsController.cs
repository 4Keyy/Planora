using Planora.Realtime.Application.Response;
using Planora.Realtime.Infrastructure.Services;
using ConnectionInfo = Planora.Realtime.Application.Response.ConnectionInfo;

namespace Planora.Realtime.Api.Controllers
{
    [ApiController]
    [Route("api/v1/[controller]")]
    [Authorize]
    [Produces("application/json")]
    public sealed class ConnectionsController : ControllerBase
    {
        private readonly IConnectionManager _connectionManager;
        private readonly ILogger<ConnectionsController> _logger;

        public ConnectionsController(
            IConnectionManager connectionManager,
            ILogger<ConnectionsController> logger)
        {
            _connectionManager = connectionManager;
            _logger = logger;
        }

        [HttpGet("active")]
        [ProducesResponseType(typeof(ActiveConnectionsResponse), StatusCodes.Status200OK)]
        public IActionResult GetActiveConnections()
        {
            var userId = User.FindFirst("sub")?.Value;

            if (string.IsNullOrEmpty(userId))
            {
                return Unauthorized(new { error = "USER_NOT_AUTHENTICATED" });
            }

            var connections = _connectionManager.GetUserConnections(userId);

            return Ok(new ActiveConnectionsResponse
            {
                UserId = userId,
                ConnectionCount = connections.Count,
                Connections = connections.Select(c => new ConnectionInfo
                {
                    ConnectionId = c,
                    ConnectedAt = DateTime.UtcNow
                }).ToList()
            });
        }

        [HttpGet("stats")]
        [Authorize(Roles = "Admin")]
        [ProducesResponseType(typeof(ConnectionStatsResponse), StatusCodes.Status200OK)]
        public IActionResult GetStats()
        {
            var totalConnections = _connectionManager.GetTotalConnections();

            return Ok(new ConnectionStatsResponse
            {
                TotalConnections = totalConnections,
                Timestamp = DateTime.UtcNow
            });
        }
    }
}
