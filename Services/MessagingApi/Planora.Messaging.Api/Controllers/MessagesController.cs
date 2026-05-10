using Planora.BuildingBlocks.Application.Pagination;
using Planora.BuildingBlocks.Infrastructure.Context;
using Planora.Messaging.Application.DTOs;
using Planora.Messaging.Application.Features.Messages.Commands.SendMessage;
using Planora.Messaging.Application.Features.Messages.Queries.GetMessages;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Planora.Messaging.Api.Controllers
{
    [ApiController]
    [Route("api/v1/[controller]")]
    [Authorize]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public sealed class MessagesController : ControllerBase
    {
        private readonly IMediator _mediator;
        private readonly ILogger<MessagesController> _logger;
        private readonly ICurrentUserContext _currentUserContext;

        public MessagesController(
            IMediator mediator, 
            ILogger<MessagesController> logger,
            ICurrentUserContext currentUserContext)
        {
            _mediator = mediator;
            _logger = logger;
            _currentUserContext = currentUserContext;
        }

        [HttpPost]
        [ProducesResponseType(typeof(SendMessageResponse), StatusCodes.Status201Created)]
        [ProducesResponseType(StatusCodes.Status400BadRequest)]
        public async Task<IActionResult> SendMessage(
            [FromBody] SendMessageCommand command,
            CancellationToken cancellationToken)
        {
            var sendCommand = command with { SenderId = null }; // Use current user context
            var result = await _mediator.Send(sendCommand, cancellationToken);
            return CreatedAtAction(nameof(SendMessage), new { messageId = result.MessageId }, result);
        }

        [HttpGet]
        [ProducesResponseType(typeof(PagedResult<MessageDto>), StatusCodes.Status200OK)]
        public async Task<IActionResult> GetMessages(
            [FromQuery] Guid? otherUserId,
            [FromQuery] int page = 1,
            [FromQuery] int pageSize = 20,
            CancellationToken cancellationToken = default)
        {
            var userId = _currentUserContext.UserId;

            var query = new GetMessagesQuery(userId, otherUserId ?? Guid.Empty, page, pageSize);
            var result = await _mediator.Send(query, cancellationToken);
            return Ok(result);
        }

        [HttpGet("health")]
        [AllowAnonymous]
        public IActionResult Health()
        {
            return Ok(new { status = "ok" });
        }
    }
}
