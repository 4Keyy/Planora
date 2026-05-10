using Planora.Category.Application.DTOs;

namespace Planora.Category.Application.Features.Categories.Queries.GetUserCategories
{
    public sealed record GetUserCategoriesQuery(Guid? UserId = null) : IQuery<Result<IReadOnlyList<CategoryDto>>>;
}
