using Planora.Todo.Domain.Entities;
using System.Linq.Expressions;

namespace Planora.Todo.Domain.Repositories
{
    public interface ITodoRepository : IRepository<TodoItem>
    {
        Task<IReadOnlyList<TodoItem>> GetByUserIdAsync(Guid userId, CancellationToken cancellationToken = default);

        /// <summary>
        /// Soft-deletes every todo owned by a user (used when that user's account is deleted) and
        /// returns how many were affected. Loads tracked so the xmin concurrency token is captured;
        /// changes are flushed by the caller's unit of work.
        /// </summary>
        Task<int> SoftDeleteByUserIdAsync(Guid userId, Guid deletedBy, CancellationToken cancellationToken = default);
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

        /// <summary>
        /// Returns the number of active (not done, not deleted) tasks the user is currently working on as a worker.
        /// </summary>
        Task<int> GetActiveWorkerTaskCountAsync(Guid userId, CancellationToken cancellationToken = default);

        /// <summary>
        /// Returns the subtasks (children) of a parent task, oldest first, with includes. Read-only.
        /// </summary>
        Task<IReadOnlyList<TodoItem>> GetSubtasksAsync(Guid parentTodoId, CancellationToken cancellationToken = default);

        /// <summary>
        /// Returns the tracked subtasks of a parent task so they can be mutated (e.g. to propagate
        /// the parent's category/visibility changes or to soft-delete them with the parent).
        /// </summary>
        Task<IReadOnlyList<TodoItem>> GetSubtasksTrackedAsync(Guid parentTodoId, CancellationToken cancellationToken = default);

        /// <summary>
        /// True when the parent task has no subtask still open — i.e. every subtask is done, or there
        /// are no subtasks at all. Used to decide between the "ready for review" and the
        /// "all participants done (subtasks remain)" notification. A single EXISTS query, no load.
        /// </summary>
        Task<bool> AreAllSubtasksCompletedAsync(Guid parentTodoId, CancellationToken cancellationToken = default);

        /// <summary>
        /// Removes all TodoItemShare rows that represent sharing between two users whose
        /// friendship has been revoked. Deletes shares in both directions.
        /// </summary>
        Task RemoveSharesBetweenUsersAsync(Guid userId, Guid friendId, CancellationToken cancellationToken = default);
    }
}
