using Planora.Auth.Application.Features.Users.Commands.ChangeEmail;
using Planora.Auth.Application.Features.Users.Commands.ChangePassword;
using Planora.Auth.Application.Features.Users.Commands.Confirm2FA;
using Planora.Auth.Application.Features.Users.Commands.DeleteUser;
using Planora.Auth.Application.Features.Users.Commands.Disable2FA;
using Planora.Auth.Application.Features.Users.Commands.Enable2FA;
using Planora.Auth.Application.Features.Users.Commands.ResendEmailVerification;
using Planora.Auth.Application.Features.Users.Commands.RevokeAllSessions;
using Planora.Auth.Application.Features.Users.Commands.RevokeSession;
using Planora.Auth.Application.Features.Users.Commands.UpdateUser;
using Planora.Auth.Application.Features.Users.Commands.VerifyEmail;
using Planora.Auth.Application.Features.Users.Queries.GetCurrentUser;
using Planora.Auth.Application.Features.Users.Queries.GetLoginHistory;
using Planora.Auth.Application.Features.Users.Queries.GetUser;
using Planora.Auth.Application.Features.Users.Queries.GetUsers;
using Planora.Auth.Application.Features.Users.Queries.GetUserSecurity;
using Planora.Auth.Application.Features.Users.Queries.GetUserSessions;
using Planora.Auth.Application.Features.Users.Queries.GetUserStatistics;
using Planora.BuildingBlocks.Application.Pagination;

namespace Planora.Auth.Api.Controllers
{
    [ApiController]
    [Route("api/v1/[controller]")]
    [Authorize]
    [Produces("application/json")]
    public sealed class UsersController : ControllerBase
    {
        private readonly IMediator _mediator;
        private readonly ILogger<UsersController> _logger;

        public UsersController(
            IMediator mediator,
            ILogger<UsersController> logger)
        {
            _mediator = mediator;
            _logger = logger;
        }

        [HttpGet("me")]
        [ProducesResponseType(typeof(UserDto), StatusCodes.Status200OK)]
        public async Task<IActionResult> GetCurrentUser(CancellationToken cancellationToken)
        {
            var result = await _mediator.Send(new GetCurrentUserQuery(), cancellationToken);

            if (result.IsFailure)
            {
                return StatusCode(500, result.Error);
            }

            return Ok(result.Value);
        }

        [HttpGet("{userId:guid}")]
        [Authorize(Roles = "Admin")]
        [ProducesResponseType(typeof(UserDetailDto), StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status404NotFound)]
        public async Task<IActionResult> GetUser(
            Guid userId,
            CancellationToken cancellationToken)
        {
            var result = await _mediator.Send(new GetUserQuery(userId), cancellationToken);

            if (result.IsFailure)
            {
                return NotFound(result.Error);
            }

            return Ok(result.Value);
        }

        [HttpGet]
        [Authorize(Roles = "Admin")]
        [ProducesResponseType(typeof(PagedResult<UserListDto>), StatusCodes.Status200OK)]
        public async Task<IActionResult> GetUsers(
            [FromQuery] GetUsersQuery query,
            CancellationToken cancellationToken)
        {
            var result = await _mediator.Send(query, cancellationToken);

            if (result.IsFailure)
            {
                return StatusCode(500, result.Error);
            }

            return Ok(result.Value);
        }

        [HttpPut("me")]
        [ProducesResponseType(typeof(UserDto), StatusCodes.Status200OK)]
        public async Task<IActionResult> UpdateProfile(
            [FromBody] UpdateUserCommand command,
            CancellationToken cancellationToken)
        {
            var result = await _mediator.Send(command, cancellationToken);

            if (result.IsFailure)
            {
                return BadRequest(result.Error);
            }

            return Ok(result.Value);
        }

        [HttpDelete("me")]
        [ProducesResponseType(StatusCodes.Status200OK)]
        public async Task<IActionResult> DeleteAccount(
            [FromBody] DeleteUserCommand command,
            CancellationToken cancellationToken)
        {
            var result = await _mediator.Send(command, cancellationToken);

            if (result.IsFailure)
            {
                return BadRequest(result.Error);
            }

            return Ok(new { message = "Account deleted successfully" });
        }

        [HttpPost("me/change-password")]
        [ProducesResponseType(StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status400BadRequest)]
        public async Task<IActionResult> ChangePassword(
            [FromBody] ChangePasswordCommand command,
            CancellationToken cancellationToken)
        {
            var result = await _mediator.Send(command, cancellationToken);

            if (result.IsFailure)
            {
                return BadRequest(result.Error);
            }

            return Ok(new { message = "Password changed successfully" });
        }

        [HttpPost("me/change-email")]
        [ProducesResponseType(StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status400BadRequest)]
        public async Task<IActionResult> ChangeEmail(
            [FromBody] ChangeEmailCommand command,
            CancellationToken cancellationToken)
        {
            var result = await _mediator.Send(command, cancellationToken);

            if (result.IsFailure)
            {
                return BadRequest(result.Error);
            }

            return Ok(new { message = "Email changed successfully. Please verify your new email." });
        }

        [HttpGet("verify-email")]
        [AllowAnonymous]
        [ProducesResponseType(StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status400BadRequest)]
        public async Task<IActionResult> VerifyEmailByToken(
            [FromQuery] string token,
            CancellationToken cancellationToken)
        {
            var result = await _mediator.Send(
                new VerifyEmailCommand { Token = token },
                cancellationToken);

            if (result.IsFailure)
            {
                return BadRequest(result.Error);
            }

            return Ok(new { message = "Email verified successfully" });
        }

        [HttpPost("me/verify-email")]
        [ProducesResponseType(StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status400BadRequest)]
        public async Task<IActionResult> VerifyEmail(
            [FromBody] VerifyEmailCommand? command,
            CancellationToken cancellationToken)
        {
            var result = string.IsNullOrWhiteSpace(command?.Token)
                ? await _mediator.Send(new ResendEmailVerificationCommand(), cancellationToken)
                : await _mediator.Send(command, cancellationToken);

            if (result.IsFailure)
            {
                return BadRequest(result.Error);
            }

            var message = string.IsNullOrWhiteSpace(command?.Token)
                ? "Email verification link sent"
                : "Email verified successfully";

            return Ok(new { message });
        }

        [HttpGet("me/security")]
        [ProducesResponseType(typeof(UserSecurityDto), StatusCodes.Status200OK)]
        public async Task<IActionResult> GetSecurity(CancellationToken cancellationToken)
        {
            var result = await _mediator.Send(new GetUserSecurityQuery(), cancellationToken);

            if (result.IsFailure)
            {
                return StatusCode(500, result.Error);
            }

            return Ok(result.Value);
        }

        [HttpPost("me/2fa/enable")]
        [ProducesResponseType(typeof(Enable2FAResponse), StatusCodes.Status200OK)]
        public async Task<IActionResult> Enable2FA(CancellationToken cancellationToken)
        {
            var result = await _mediator.Send(new Enable2FACommand(), cancellationToken);

            if (result.IsFailure)
            {
                return BadRequest(result.Error);
            }

            return Ok(result.Value);
        }

        [HttpPost("me/2fa/confirm")]
        [ProducesResponseType(StatusCodes.Status200OK)]
        public async Task<IActionResult> Confirm2FA(
            [FromBody] Confirm2FACommand command,
            CancellationToken cancellationToken)
        {
            var result = await _mediator.Send(command, cancellationToken);

            if (result.IsFailure)
            {
                return BadRequest(result.Error);
            }

            return Ok(new { message = "Two-factor authentication enabled successfully" });
        }

        [HttpPost("me/2fa/disable")]
        [ProducesResponseType(StatusCodes.Status200OK)]
        public async Task<IActionResult> Disable2FA(
            [FromBody] Disable2FACommand command,
            CancellationToken cancellationToken)
        {
            var result = await _mediator.Send(command, cancellationToken);

            if (result.IsFailure)
            {
                return BadRequest(result.Error);
            }

            return Ok(new { message = "Two-factor authentication disabled successfully" });
        }

        [HttpGet("me/sessions")]
        [ProducesResponseType(typeof(List<SessionDto>), StatusCodes.Status200OK)]
        public async Task<IActionResult> GetSessions(CancellationToken cancellationToken)
        {
            var result = await _mediator.Send(new GetUserSessionsQuery(), cancellationToken);

            if (result.IsFailure)
            {
                return StatusCode(500, result.Error);
            }

            return Ok(result.Value);
        }

        [HttpDelete("me/sessions/{tokenId:guid}")]
        [ProducesResponseType(StatusCodes.Status200OK)]
        public async Task<IActionResult> RevokeSession(
            Guid tokenId,
            CancellationToken cancellationToken)
        {
            var result = await _mediator.Send(
                new RevokeSessionCommand { TokenId = tokenId },
                cancellationToken);

            if (result.IsFailure)
            {
                return BadRequest(result.Error);
            }

            return Ok(new { message = "Session revoked successfully" });
        }

        [HttpPost("me/sessions/revoke-all")]
        [ProducesResponseType(StatusCodes.Status200OK)]
        public async Task<IActionResult> RevokeAllSessions(
            [FromBody] RevokeAllSessionsCommand command,
            CancellationToken cancellationToken)
        {
            var result = await _mediator.Send(command, cancellationToken);

            if (result.IsFailure)
            {
                return BadRequest(result.Error);
            }

            return Ok(new { message = "All sessions revoked successfully" });
        }

        [HttpGet("me/login-history")]
        [ProducesResponseType(typeof(PagedResult<LoginHistoryPagedDto>), StatusCodes.Status200OK)]
        public async Task<IActionResult> GetLoginHistory(
            [FromQuery] GetLoginHistoryQuery query,
            CancellationToken cancellationToken)
        {
            var result = await _mediator.Send(query, cancellationToken);

            if (result.IsFailure)
            {
                return StatusCode(500, result.Error);
            }

            return Ok(result.Value);
        }

        [HttpGet("statistics")]
        [Authorize(Roles = "Admin")]
        [ProducesResponseType(typeof(UserStatisticsDto), StatusCodes.Status200OK)]
        public async Task<IActionResult> GetStatistics(CancellationToken cancellationToken)
        {
            var result = await _mediator.Send(
                new GetUserStatisticsQuery(),
                cancellationToken);

            if (result.IsFailure)
            {
                return StatusCode(500, result.Error);
            }

            return Ok(result.Value);
        }
    }
}
