using Planora.BuildingBlocks.Application.Pagination;
using Planora.Collaboration.Application.DTOs;
using Planora.Collaboration.Application.Features.Comments.Commands.AddComment;
using Planora.Collaboration.Application.Features.Comments.Commands.UpdateComment;
using Planora.Collaboration.Application.Features.Comments.Commands.DeleteComment;
using Planora.Collaboration.Application.Features.Comments.Queries.GetComments;

namespace Planora.Collaboration.Api.Controllers
{
    /// <summary>
    /// Task comment timeline ("ветки"). The route is keyed by the task id (owned by TodoApi);
    /// this service authorises every operation via the Todo gRPC access contract.
    /// </summary>
    [ApiController]
    [Route("api/v1/[controller]")]
    [Authorize]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public sealed class CommentsController : ControllerBase
    {
        private readonly IMediator _mediator;
        private readonly ILogger<CommentsController> _logger;

        public CommentsController(IMediator mediator, ILogger<CommentsController> logger)
        {
            _mediator = mediator;
            _logger = logger;
        }

        [HttpGet("{taskId}")]
        [ProducesResponseType(StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status404NotFound)]
        public async Task<ActionResult<PagedResult<CommentDto>>> GetComments(
            [FromRoute] Guid taskId,
            [FromQuery] int pageNumber = 1,
            [FromQuery] int pageSize = 50,
            CancellationToken cancellationToken = default)
        {
            var result = await _mediator.Send(new GetCommentsQuery(taskId, pageNumber, pageSize), cancellationToken);
            if (result.IsFailure)
                return BadRequest(result.Error);
            return Ok(result.Value);
        }

        [HttpPost("{taskId}")]
        [ProducesResponseType(StatusCodes.Status201Created)]
        [ProducesResponseType(StatusCodes.Status400BadRequest)]
        [ProducesResponseType(StatusCodes.Status403Forbidden)]
        public async Task<ActionResult<CommentDto>> AddComment(
            [FromRoute] Guid taskId,
            [FromBody] AddCommentRequest request,
            CancellationToken cancellationToken = default)
        {
            var result = await _mediator.Send(new AddCommentCommand(taskId, request.Content), cancellationToken);
            if (result.IsFailure)
                return BadRequest(result.Error);
            return StatusCode(StatusCodes.Status201Created, result.Value);
        }

        [HttpPut("{taskId}/{commentId}")]
        [ProducesResponseType(StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status400BadRequest)]
        [ProducesResponseType(StatusCodes.Status403Forbidden)]
        [ProducesResponseType(StatusCodes.Status404NotFound)]
        public async Task<ActionResult<CommentDto>> UpdateComment(
            [FromRoute] Guid taskId,
            [FromRoute] Guid commentId,
            [FromBody] UpdateCommentRequest request,
            CancellationToken cancellationToken = default)
        {
            var result = await _mediator.Send(new UpdateCommentCommand(taskId, commentId, request.Content), cancellationToken);
            if (result.IsFailure)
                return BadRequest(result.Error);
            return Ok(result.Value);
        }

        [HttpDelete("{taskId}/{commentId}")]
        [ProducesResponseType(StatusCodes.Status204NoContent)]
        [ProducesResponseType(StatusCodes.Status403Forbidden)]
        [ProducesResponseType(StatusCodes.Status404NotFound)]
        public async Task<IActionResult> DeleteComment(
            [FromRoute] Guid taskId,
            [FromRoute] Guid commentId,
            CancellationToken cancellationToken = default)
        {
            var result = await _mediator.Send(new DeleteCommentCommand(taskId, commentId), cancellationToken);
            if (result.IsFailure)
                return BadRequest(result.Error);
            return NoContent();
        }
    }

    public sealed record AddCommentRequest(string Content);
    public sealed record UpdateCommentRequest(string Content);
}
