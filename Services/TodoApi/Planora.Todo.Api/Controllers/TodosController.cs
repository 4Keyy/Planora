using Planora.BuildingBlocks.Application.Pagination;
using Planora.BuildingBlocks.Infrastructure.Extensions;
using Planora.Todo.Application.DTOs;
using Planora.Todo.Application.Features.Todos.Commands.CreateTodo;
using Planora.Todo.Application.Features.Todos.Commands.UpdateTodo;
using Planora.Todo.Application.Features.Todos.Commands.DeleteTodo;
using Planora.Todo.Application.Features.Todos.Commands.SetTodoHidden;
using Planora.Todo.Application.Features.Todos.Commands.SetViewerPreference;
using Planora.Todo.Application.Features.Todos.Queries.GetUserTodos;
using Planora.Todo.Application.Features.Todos.Queries.GetPublicTodos;
using Planora.Todo.Application.Features.Todos.Queries.GetTodosByCategory;
using Planora.Todo.Application.Features.Todos.Queries.GetTodoById;

namespace Planora.Todo.Api.Controllers
{
    [ApiController]
    [Route("api/v1/[controller]")]
    [Authorize]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public sealed class TodosController : ControllerBase
    {
        private readonly IMediator _mediator;
        private readonly ILogger<TodosController> _logger;

        public TodosController(IMediator mediator, ILogger<TodosController> logger)
        {
            _mediator = mediator;
            _logger = logger;
        }

        [HttpGet]
        [ProducesResponseType(StatusCodes.Status200OK)]
        public async Task<ActionResult<PagedResult<TodoItemDto>>> GetTodos(
            [FromQuery] int pageNumber = 1,
            [FromQuery] int pageSize = 10,
            [FromQuery] string? status = null,
            [FromQuery] Guid? categoryId = null,
            [FromQuery] bool? isCompleted = null,
            CancellationToken cancellationToken = default)
        {
            var query = new GetUserTodosQuery(null, pageNumber, pageSize, status, categoryId, isCompleted);
            var result = await _mediator.Send(query, cancellationToken);

            return Ok(result);
        }

        [HttpGet("public")]
        [ProducesResponseType(StatusCodes.Status200OK)]
        public async Task<ActionResult<PagedResult<TodoItemDto>>> GetPublicTodos(
            [FromQuery] int pageNumber = 1,
            [FromQuery] int pageSize = 10,
            [FromQuery] Guid? friendId = null,
            CancellationToken cancellationToken = default)
        {
            var query = new GetPublicTodosQuery(pageNumber, pageSize, friendId);
            var result = await _mediator.Send(query, cancellationToken);

            return Ok(result);
        }

        [HttpGet("{id}")]
        [ProducesResponseType(StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status404NotFound)]
        public async Task<ActionResult<TodoItemDto>> GetTodoById(
            [FromRoute] Guid id,
            CancellationToken cancellationToken = default)
        {
            var query = new GetTodoByIdQuery(id);
            var result = await _mediator.Send(query, cancellationToken);
            
            if (result.IsFailure)
                return NotFound(result.Error);

            return Ok(result.Value);
        }

        [HttpPost]
        [ProducesResponseType(StatusCodes.Status201Created)]
        [ProducesResponseType(StatusCodes.Status400BadRequest)]
        public async Task<ActionResult<TodoItemDto>> CreateTodo(
            [FromBody] CreateTodoCommand command,
            CancellationToken cancellationToken = default)
        {
            var result = await _mediator.Send(command, cancellationToken);
            
            if (result.IsFailure)
                return BadRequest(result.Error);

            return CreatedAtAction(
                nameof(GetTodoById), 
                new { id = result.Value!.Id }, 
                result.Value);
        }

        [HttpPut("{id}")]
        [ProducesResponseType(StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status404NotFound)]
        [ProducesResponseType(StatusCodes.Status400BadRequest)]
        public async Task<ActionResult<TodoItemDto>> UpdateTodo(
            [FromRoute] Guid id,
            [FromBody] UpdateTodoCommand command,
            CancellationToken cancellationToken = default)
        {
            var updateCommand = command with { TodoId = id };
            var result = await _mediator.Send(updateCommand, cancellationToken);
            
            if (result.IsFailure)
                return BadRequest(result.Error);

            return Ok(result.Value);
        }

        [HttpDelete("{id}")]
        [ProducesResponseType(StatusCodes.Status204NoContent)]
        [ProducesResponseType(StatusCodes.Status404NotFound)]
        public async Task<IActionResult> DeleteTodo(
            [FromRoute] Guid id,
            CancellationToken cancellationToken = default)
        {
            var command = new DeleteTodoCommand(id);
            var result = await _mediator.Send(command, cancellationToken);
            if (result.IsFailure)
                return NotFound(result.Error);
            return NoContent();
        }

        [HttpPatch("{id}/hidden")]
        [ProducesResponseType(StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status404NotFound)]
        [ProducesResponseType(StatusCodes.Status403Forbidden)]
        public async Task<ActionResult<TodoHiddenResponseDto>> SetHidden(
            [FromRoute] Guid id,
            [FromBody] SetHiddenRequest request,
            CancellationToken cancellationToken = default)
        {
            var command = new SetTodoHiddenCommand(id, request.Hidden);
            var result = await _mediator.Send(command, cancellationToken);

            if (result.IsFailure)
                return BadRequest(result.Error);

            return Ok(result.Value);
        }

        [HttpPatch("{id}/viewer-preferences")]
        [ProducesResponseType(StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status400BadRequest)]
        [ProducesResponseType(StatusCodes.Status404NotFound)]
        public async Task<ActionResult<ViewerPreferenceResponseDto>> SetViewerPreference(
            [FromRoute] Guid id,
            [FromBody] SetViewerPreferenceRequest request,
            CancellationToken cancellationToken = default)
        {
            var command = new SetViewerPreferenceCommand(
                id,
                request.HiddenByViewer,
                request.ViewerCategoryId,
                request.UpdateViewerCategory);
            var result = await _mediator.Send(command, cancellationToken);

            if (result.IsFailure)
            {
                if (result.Error?.Code == "OWNER_MUST_USE_HIDDEN_ENDPOINT")
                    return BadRequest(result.Error);

                return BadRequest(result.Error);
            }

            return Ok(result.Value);
        }
    }
}

public sealed record SetHiddenRequest(bool Hidden);
public sealed record SetViewerPreferenceRequest(
    bool? HiddenByViewer = null,
    Guid? ViewerCategoryId = null,
    bool UpdateViewerCategory = false);
