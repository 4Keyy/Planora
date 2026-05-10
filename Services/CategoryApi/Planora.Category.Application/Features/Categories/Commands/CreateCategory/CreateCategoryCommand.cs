using Planora.Category.Application.DTOs;

namespace Planora.Category.Application.Features.Categories.Commands.CreateCategory
{
    public sealed record CreateCategoryCommand(
        Guid? UserId,
        string Name,
        string? Description,
        string? Color,
        string? Icon,
        int DisplayOrder = 0) : ICommand<Result<CategoryDto>>;
}
