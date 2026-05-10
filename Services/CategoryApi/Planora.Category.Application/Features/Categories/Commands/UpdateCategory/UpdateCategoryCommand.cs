using Planora.Category.Application.DTOs;

namespace Planora.Category.Application.Features.Categories.Commands.UpdateCategory
{
    public sealed record UpdateCategoryCommand(
        Guid CategoryId,
        string? Name = null,
        string? Description = null,
        string? Color = null,
        string? Icon = null,
        int? DisplayOrder = null) : ICommand<Result<CategoryDto>>;
}
