namespace Planora.Category.Application.Features.Categories.Commands.DeleteCategory
{
    public sealed record DeleteCategoryCommand(Guid CategoryId) : ICommand<Result>;
}
