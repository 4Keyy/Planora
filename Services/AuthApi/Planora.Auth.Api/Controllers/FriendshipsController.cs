using Planora.Auth.Application.Features.Friendships.Commands.AcceptFriendRequest;
using Planora.Auth.Application.Features.Friendships.Commands.RejectFriendRequest;
using Planora.Auth.Application.Features.Friendships.Commands.RemoveFriend;
using Planora.Auth.Application.Features.Friendships.Commands.SendFriendRequest;
using Planora.Auth.Application.Features.Friendships.Commands.SendFriendRequestByEmail;
using Planora.Auth.Application.Features.Friendships.Queries.GetFriendRequests;
using Planora.Auth.Application.Features.Friendships.Queries.GetFriends;
using Planora.Auth.Application.Features.Friendships.Queries.GetFriendIds;
using Planora.BuildingBlocks.Application.Pagination;

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
        /// Requires authentication — callers must present a valid JWT.
        /// Internal microservices obtain a service token via the auth flow.
        /// </summary>
        [HttpGet("friend-ids")]
        [ProducesResponseType(StatusCodes.Status200OK)]
        public async Task<ActionResult<List<Guid>>> GetFriendIds(
            [FromQuery] Guid userId,
            CancellationToken cancellationToken = default)
        {
            try
            {
                var query = new GetFriendIdsQuery(userId);
                var result = await _mediator.Send(query, cancellationToken);

                if (result.IsFailure)
                    return BadRequest();

                return Ok(new { value = result.Value });
            }
            catch
            {
                return Ok(new { value = new List<Guid>() });
            }
        }

        /// <summary>
        /// Check if two users are friends (for internal service calls).
        /// Requires authentication — callers must present a valid JWT.
        /// </summary>
        [HttpGet("are-friends")]
        [ProducesResponseType(StatusCodes.Status200OK)]
        public async Task<ActionResult<bool>> AreFriends(
            [FromQuery] Guid userId1,
            [FromQuery] Guid userId2,
            CancellationToken cancellationToken = default)
        {
            try
            {
                var friendIds = await _mediator.Send(new GetFriendIdsQuery(userId1), cancellationToken);

                if (friendIds.IsFailure)
                    return Ok(new { value = false });

                var areFriends = friendIds.Value.Contains(userId2);
                return Ok(new { value = areFriends });
            }
            catch
            {
                return Ok(new { value = false });
            }
        }
    }
}

