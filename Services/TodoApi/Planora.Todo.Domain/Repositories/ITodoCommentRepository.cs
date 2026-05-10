using Planora.BuildingBlocks.Domain.Interfaces;
using Planora.Todo.Domain.Entities;

namespace Planora.Todo.Domain.Repositories
{
    public interface ITodoCommentRepository : IRepository<TodoItemComment>
    {
        Task<(IReadOnlyList<TodoItemComment> Items, int TotalCount)> GetPagedByTodoIdAsync(
            Guid todoItemId, int pageNumber, int pageSize, CancellationToken ct = default);
        Task SoftDeleteByTodoIdAsync(Guid todoItemId, Guid deletedBy, CancellationToken ct = default);
    }
}
