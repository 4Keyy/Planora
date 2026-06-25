using Planora.Auth.Application.Features.Friendships.Commands.AcceptFriendRequest;
using Planora.Auth.Application.Features.Friendships.Commands.RejectFriendRequest;
using Planora.Auth.Application.Features.Friendships.Commands.RemoveFriend;
using Planora.Auth.Application.Features.Friendships.Commands.SendFriendRequest;
using Planora.Auth.Application.Features.Friendships.Commands.SendFriendRequestByEmail;
using Planora.Auth.Application.Features.Friendships.Queries.GetFriendRequests;
using Planora.Auth.Application.Features.Friendships.Queries.GetFriends;
using Planora.Auth.Application.Features.Friendships.Queries.GetFriendIds;
using Planora.BuildingBlocks.Application.Pagination;
using System.Security.Claims;

namespace Planora.Auth.Api.Controllers
{
    [ApiController]
    [Route("api/v1/[controller]")]
    [Authorize]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public sealed class FriendshipsController : ControllerBase
    {
        private readonly IMediator _mediator;
        private readonly ILogger<FriendshipsController> _logger;

        public FriendshipsController(IMediator mediator, ILogger<FriendshipsController> logger)
        {
            _mediator = mediator;
            _logger = logger;
        }

        /// <summary>
        /// The authenticated caller's subject id. The default inbound claim mapping
        /// (<c>JwtBearerOptions.MapInboundClaims</c> = true) remaps the token's <c>sub</c> to
        /// <see cref="ClaimTypes.NameIdentifier"/>, so BOTH must be checked — reading only <c>sub</c>
        /// returns null against a real token and makes the self-scoped guards below reject every
        /// request with 403. Mirrors <c>CurrentUserContext</c> / <c>CurrentUserService</c>.
        /// </summary>
        private string? CallerSubject =>
            User.FindFirst("sub")?.Value ?? User.FindFirst(ClaimTypes.NameIdentifier)?.Value;

        [HttpPost("requests")]
        [ProducesResponseType(StatusCodes.Status201Created)]
        [ProducesResponseType(StatusCodes.Status400BadRequest)]
        public async Task<IActionResult> SendFriendRequest(
            [FromBody] SendFriendRequestCommand command,
            CancellationToken cancellationToken = default)
        {
            var result = await _mediator.Send(command, cancellationToken);
            if (result.IsFailure)
                return BadRequest(result.Error);

            return CreatedAtAction(nameof(GetFriendRequests), new { incoming = true });
        }

        [HttpPost("requests/by-email")]
        [ProducesResponseType(StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status400BadRequest)]
        public async Task<IActionResult> SendFriendRequestByEmail(
            [FromBody] SendFriendRequestByEmailCommand command,
            CancellationToken cancellationToken = default)
        {
            var result = await _mediator.Send(command, cancellationToken);
            if (result.IsFailure)
                return BadRequest(result.Error);

            return Ok(new
            {
                message = "If that email can receive friend requests, the invitation has been sent."
            });
        }

        [HttpPost("requests/{friendshipId}/accept")]
        [ProducesResponseType(StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status400BadRequest)]
        public async Task<IActionResult> AcceptFriendRequest(
            [FromRoute] Guid friendshipId,
            CancellationToken cancellationToken = default)
        {
            var command = new AcceptFriendRequestCommand(friendshipId);
            var result = await _mediator.Send(command, cancellationToken);
            if (result.IsFailure)
                return BadRequest(result.Error);

            return Ok(result);
        }

        [HttpPost("requests/{friendshipId}/reject")]
        [ProducesResponseType(StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status400BadRequest)]
        public async Task<IActionResult> RejectFriendRequest(
            [FromRoute] Guid friendshipId,
            CancellationToken cancellationToken = default)
        {
            var command = new RejectFriendRequestCommand(friendshipId);
            var result = await _mediator.Send(command, cancellationToken);
            if (result.IsFailure)
                return BadRequest(result.Error);

            return Ok(result);
        }

        [HttpDelete("{friendId}")]
        [ProducesResponseType(StatusCodes.Status204NoContent)]
        [ProducesResponseType(StatusCodes.Status400BadRequest)]
        public async Task<IActionResult> RemoveFriend(
            [FromRoute] Guid friendId,
            CancellationToken cancellationToken = default)
        {
            var command = new RemoveFriendCommand(friendId);
            var result = await _mediator.Send(command, cancellationToken);
            if (result.IsFailure)
                return BadRequest(result.Error);

            return NoContent();
        }

        [HttpGet]
        [ProducesResponseType(StatusCodes.Status200OK)]
        public async Task<ActionResult<PagedResult<FriendDto>>> GetFriends(
            [FromQuery] int pageNumber = 1,
            [FromQuery] int pageSize = 10,
            CancellationToken cancellationToken = default)
        {
            var query = new GetFriendsQuery(pageNumber, pageSize);
            var result = await _mediator.Send(query, cancellationToken);
            if (result.IsFailure)
                return BadRequest(result.Error);

            return Ok(result.Value);
        }

        [HttpGet("requests")]
        [ProducesResponseType(StatusCodes.Status200OK)]
        public async Task<ActionResult<IReadOnlyList<FriendRequestDto>>> GetFriendRequests(
            [FromQuery] bool incoming = true,
            CancellationToken cancellationToken = default)
        {
            var query = new GetFriendRequestsQuery(incoming);
            var result = await _mediator.Send(query, cancellationToken);
            if (result.IsFailure)
                return BadRequest(result.Error);

            return Ok(result.Value);
        }

        /// <summary>
        /// Get list of friend IDs for internal service calls (e.g., Todo API).
        /// The userId query parameter must match the authenticated caller's own user ID.
        /// </summary>
        [HttpGet("friend-ids")]
        [ProducesResponseType(StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status403Forbidden)]
        public async Task<ActionResult<List<Guid>>> GetFriendIds(
            [FromQuery] Guid userId,
            CancellationToken cancellationToken = default)
        {
            // SECURITY: enforce that callers can only query their own friend list.
            var callerIdRaw = CallerSubject;
            if (!Guid.TryParse(callerIdRaw, out var callerId) || callerId != userId)
                return Forbid();

            try
            {
                var query = new GetFriendIdsQuery(userId);
                var result = await _mediator.Send(query, cancellationToken);

                if (result.IsFailure)
                    return BadRequest();

                return Ok(new { value = result.Value });
            }
            catch (Exception ex)
            {
                // Fail CLOSED (empty list) so a lookup outage can never widen a caller's visibility —
                // but never SILENTLY: log it so the failure is observable instead of masquerading as
                // a legitimate "this user has no friends" result.
                _logger.LogError(ex, "Friend-ids lookup failed for user {UserId}; failing closed to an empty list", userId);
                return Ok(new { value = new List<Guid>() });
            }
        }

        /// <summary>
        /// Check if two users are friends (for internal service calls).
        /// userId1 must match the authenticated caller's own user ID.
        /// </summary>
        [HttpGet("are-friends")]
        [ProducesResponseType(StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status403Forbidden)]
        public async Task<ActionResult<bool>> AreFriends(
            [FromQuery] Guid userId1,
            [FromQuery] Guid userId2,
            CancellationToken cancellationToken = default)
        {
            // SECURITY: only the authenticated user may check their own friendship status.
            var callerIdRaw = CallerSubject;
            if (!Guid.TryParse(callerIdRaw, out var callerId) || callerId != userId1)
                return Forbid();

            try
            {
                var friendIds = await _mediator.Send(new GetFriendIdsQuery(userId1), cancellationToken);

                if (friendIds.IsFailure)
                    return Ok(new { value = false });

                var areFriends = friendIds.Value.Contains(userId2);
                return Ok(new { value = areFriends });
            }
            catch (Exception ex)
            {
                // Fail CLOSED (not friends) on any lookup outage so it can never grant visibility, and
                // log it so the failure surfaces instead of silently reading as "not friends".
                _logger.LogError(ex, "Friendship check failed for user {UserId}; failing closed to not-friends", userId1);
                return Ok(new { value = false });
            }
        }
    }
}

