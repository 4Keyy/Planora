using Planora.Todo.Domain.Entities;
using System.Linq.Expressions;

namespace Planora.Todo.Domain.Repositories
{
    public interface ITodoRepository : IRepository<TodoItem>
    {
        Task<IReadOnlyList<TodoItem>> GetByUserIdAsync(Guid userId, CancellationToken cancellationToken = default);
        Task<IReadOnlyList<TodoItem>> GetActiveByUserIdAsync(Guid userId, CancellationToken cancellationToken = default);
        Task<IReadOnlyList<TodoItem>> GetCompletedByUserIdAsync(Guid userId, CancellationToken cancellationToken = default);
        Task<IReadOnlyList<TodoItem>> GetByUserIdAndCategoryIdAsync(Guid userId, Guid categoryId, CancellationToken cancellationToken = default);
        Task<IReadOnlyList<TodoItem>> GetByCategoryIdAsync(Guid categoryId, CancellationToken cancellationToken = default);
        Task<int> GetUncompletedCountAsync(Guid userId, CancellationToken cancellationToken = default);
        Task<IReadOnlyList<TodoItem>> GetOverdueAsync(Guid userId, CancellationToken cancellationToken = default);
        Task<TodoItem?> GetByIdWithIncludesAsync(Guid id, CancellationToken cancellationToken = default);
        Task<TodoItem?> GetByIdWithIncludesTrackedAsync(Guid id, CancellationToken cancellationToken = default);
        Task<(IReadOnlyList<TodoItem> Items, int TotalCount)> FindPageWithIncludesAsync(
            Expression<Func<TodoItem, bool>> predicate,
            bool sortCompletedByCompletionTime,
            int pageNumber,
            int pageSize,
            CancellationToken cancellationToken = default);
        Task<IReadOnlyList<TodoItem>> FindWithIncludesAsync(
            Expression<Func<TodoItem, bool>> predicate,
            CancellationToken cancellationToken = default);
        Task<(IReadOnlyList<TodoItem> Items, int TotalCount)> GetPagedWithIncludesAsync(
            Expression<Func<TodoItem, bool>> predicate,
            int pageNumber,
            int pageSize,
            bool sortCompletedByCompletionTime,
            CancellationToken cancellationToken = default);
    }
}
