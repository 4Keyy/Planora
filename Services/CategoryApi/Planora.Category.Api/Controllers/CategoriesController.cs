using Planora.Category.Application.DTOs;
using Planora.Category.Application.Features.Categories.Commands.CreateCategory;
using Planora.Category.Application.Features.Categories.Commands.UpdateCategory;
using Planora.Category.Application.Features.Categories.Commands.DeleteCategory;
using Planora.Category.Application.Features.Categories.Queries.GetUserCategories;

namespace Planora.Category.Api.Controllers
{
    [ApiController]
    [Route("api/v1/[controller]")]
    [Authorize]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public sealed class CategoriesController : ControllerBase
    {
        private readonly IMediator _mediator;
        private readonly ILogger<CategoriesController> _logger;

        public CategoriesController(IMediator mediator, ILogger<CategoriesController> logger)
        {
            _mediator = mediator;
            _logger = logger;
        }

        [HttpGet]
        [ProducesResponseType(StatusCodes.Status200OK)]
        public async Task<ActionResult<IReadOnlyList<CategoryDto>>> GetCategories(
            CancellationToken cancellationToken = default)
        {
            var query = new GetUserCategoriesQuery();
            var result = await _mediator.Send(query, cancellationToken);
            return Ok(result);
        }

        [HttpPost]
        [ProducesResponseType(StatusCodes.Status201Created)]
        [ProducesResponseType(StatusCodes.Status400BadRequest)]
        public async Task<ActionResult<CategoryDto>> CreateCategory(
            [FromBody] CreateCategoryCommand command,
            CancellationToken cancellationToken = default)
        {
            var createCommand = command with { UserId = null }; // Use current user context
            var result = await _mediator.Send(createCommand, cancellationToken);
            return CreatedAtAction(nameof(GetCategories), result);
        }

        [HttpPut("{id}")]
        [ProducesResponseType(StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status404NotFound)]
        [ProducesResponseType(StatusCodes.Status400BadRequest)]
        public async Task<ActionResult<CategoryDto>> UpdateCategory(
            [FromRoute] Guid id,
            [FromBody] UpdateCategoryCommand command,
            CancellationToken cancellationToken = default)
        {
            var updateCommand = command with { CategoryId = id };
            var result = await _mediator.Send(updateCommand, cancellationToken);
            return Ok(result);
        }

        [HttpDelete("{id}")]
        [ProducesResponseType(StatusCodes.Status204NoContent)]
        [ProducesResponseType(StatusCodes.Status404NotFound)]
        public async Task<IActionResult> DeleteCategory(
            [FromRoute] Guid id,
            CancellationToken cancellationToken = default)
        {
            var command = new DeleteCategoryCommand(id);
            var result = await _mediator.Send(command, cancellationToken);

            if (result.IsFailure)
            {
                var error = result.Error!;
                return error.Code switch
                {
                    "CATEGORY_NOT_FOUND" => NotFound(error),
                    "FORBIDDEN"          => Forbid(),
                    _                    => BadRequest(error),
                };
            }

            return NoContent();
        }
    }
}
