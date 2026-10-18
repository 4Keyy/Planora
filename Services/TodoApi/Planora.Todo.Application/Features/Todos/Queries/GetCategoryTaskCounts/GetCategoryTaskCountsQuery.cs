using Planora.Todo.Application.DTOs;

namespace Planora.Todo.Application.Features.Todos.Queries.GetCategoryTaskCounts
{
    /// <summary>
    /// The number of open top-level tasks in each of the caller's categories — the count on a
    /// category card. A category with none is absent from the result.
    /// </summary>
    public sealed record GetCategoryTaskCountsQuery(Guid? UserId = null) : IQuery<IReadOnlyList<CategoryTaskCountDto>>;
}
