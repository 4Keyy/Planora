using Planora.BuildingBlocks.Infrastructure.Persistence;
using Planora.Todo.Domain.Enums;
using Planora.BuildingBlocks.Application.Pagination;
using System.Linq.Expressions;

namespace Planora.Todo.Infrastructure.Persistence.Repositories
{
    public sealed class TodoRepository : BaseRepository<TodoItem, Guid, TodoDbContext>, ITodoRepository
    {
        private readonly TimeProvider _timeProvider;

        public TodoRepository(TodoDbContext context, TimeProvider? timeProvider = null)
            : base(context)
        {
            _timeProvider = timeProvider ?? TimeProvider.System;
        }

        public async Task<IReadOnlyList<TodoItem>> GetByUserIdAsync(Guid userId, CancellationToken cancellationToken = default)
        {
            return await DbSet
                .AsNoTracking()
                .Where(t => t.UserId == userId && !t.IsDeleted)
                .OrderByDescending(t => t.CreatedAt)
                .ToListAsync(cancellationToken);
        }

        public async Task<int> SoftDeleteByUserIdAsync(Guid userId, Guid deletedBy, CancellationToken cancellationToken = default)
        {
            // Tracked load (NOT AsNoTracking) so the xmin concurrency token is captured — otherwise
            // the UPDATE issues `WHERE xmin = 0`, matches no rows, and the cleanup fails with a
            // spurious DbUpdateConcurrencyException. Caller flushes via UnitOfWork.SaveChangesAsync.
            var todos = await DbSet
                .Where(t => t.UserId == userId && !t.IsDeleted)
                .ToListAsync(cancellationToken);

            foreach (var todo in todos)
                todo.MarkAsDeleted(deletedBy);

            return todos.Count;
        }

        public async Task<IReadOnlyList<TodoItem>> GetActiveByUserIdAsync(Guid userId, CancellationToken cancellationToken = default)
        {
            return await DbSet
                .AsNoTracking()
                .Where(t => t.UserId == userId && !t.IsDeleted && t.Status != TodoStatus.Done)
                .OrderBy(t => t.ExpectedDate ?? t.CreatedAt)
                .ToListAsync(cancellationToken);
        }

        public async Task<IReadOnlyList<TodoItem>> GetCompletedByUserIdAsync(Guid userId, CancellationToken cancellationToken = default)
        {
            return await DbSet
                .AsNoTracking()
                .Where(t => t.UserId == userId && !t.IsDeleted && t.Status == TodoStatus.Done)
                .OrderByDescending(t => t.UpdatedAt)
                .ToListAsync(cancellationToken);
        }

        public async Task<IReadOnlyList<TodoItem>> GetByUserIdAndCategoryIdAsync(Guid userId, Guid categoryId, CancellationToken cancellationToken = default)
        {
            return await DbSet
                .AsNoTracking()
                .Where(t => t.UserId == userId && !t.IsDeleted && t.CategoryId == categoryId)
                .OrderBy(t => t.ExpectedDate ?? t.CreatedAt)
                .ToListAsync(cancellationToken);
        }

        public async Task<IReadOnlyList<TodoItem>> GetByCategoryIdAsync(Guid categoryId, CancellationToken cancellationToken = default)
        {
            return await DbSet
                .AsNoTracking()
                .Where(t => t.CategoryId == categoryId && !t.IsDeleted)
                .ToListAsync(cancellationToken);
        }

        public async Task<int> GetUncompletedCountAsync(Guid userId, CancellationToken cancellationToken = default)
        {
            return await DbSet
                .AsNoTracking()
                .CountAsync(t => t.UserId == userId && !t.IsDeleted && t.Status != TodoStatus.Done, cancellationToken);
        }

        public async Task<IReadOnlyList<TodoItem>> GetOverdueAsync(Guid userId, CancellationToken cancellationToken = default)
        {
            return await DbSet
                .AsNoTracking()
                .Where(t => t.UserId == userId && !t.IsDeleted && t.Status != TodoStatus.Done && t.ExpectedDate.HasValue && t.ExpectedDate.Value < DateTime.UtcNow)
                .OrderBy(t => t.ExpectedDate)
                .ToListAsync(cancellationToken);
        }

        public async Task<TodoItem?> GetByIdWithIncludesAsync(Guid id, CancellationToken cancellationToken = default)
        {
            return await DbSet
                .AsNoTracking()
                .AsSplitQuery()
                .Include(t => t.Tags)
                .Include(t => t.SharedWith)
                .Include(t => t.Workers)
                .FirstOrDefaultAsync(t => t.Id == id && !t.IsDeleted, cancellationToken);
        }

        public async Task<TodoItem?> GetByIdWithIncludesTrackedAsync(Guid id, CancellationToken cancellationToken = default)
        {
            return await DbSet
                .AsSplitQuery()
                .Include(t => t.Tags)
                .Include(t => t.SharedWith)
                .Include(t => t.Workers)
                .FirstOrDefaultAsync(t => t.Id == id && !t.IsDeleted, cancellationToken);
        }

        public async Task<(IReadOnlyList<TodoItem> Items, int TotalCount)> FindPageWithIncludesAsync(
            Expression<Func<TodoItem, bool>> predicate,
            bool sortCompletedByCompletionTime,
            int pageNumber,
            int pageSize,
            CancellationToken cancellationToken = default)
        {
            var (safePageNumber, safePageSize) = PaginationParameters.Normalize(pageNumber, pageSize);

            var query = DbSet
                .AsNoTracking()
                .Where(predicate)
                .Where(t => !t.IsDeleted);

            var totalCount = await query.CountAsync(cancellationToken);

            query = sortCompletedByCompletionTime
                ? query
                    .OrderByDescending(t => t.CompletedAt ?? t.UpdatedAt ?? t.CreatedAt)
                    .ThenByDescending(t => t.UpdatedAt ?? t.CreatedAt)
                    .ThenByDescending(t => t.CreatedAt)
                : query.OrderByDescending(t => t.CreatedAt);

            var items = await query
                .Skip((safePageNumber - 1) * safePageSize)
                .Take(safePageSize)
                .AsSplitQuery()
                .Include(t => t.Tags)
                .Include(t => t.SharedWith)
                .Include(t => t.Workers)
                .ToListAsync(cancellationToken);

            return (items, totalCount);
        }

        public async Task<IReadOnlyList<TodoItem>> FindWithIncludesAsync(
            Expression<Func<TodoItem, bool>> predicate,
            CancellationToken cancellationToken = default)
        {
            return await DbSet
                .AsNoTracking()
                .AsSplitQuery()
                .Where(predicate)
                .Where(t => !t.IsDeleted)
                .Include(t => t.Tags)
                .Include(t => t.SharedWith)
                .Include(t => t.Workers)
                .ToListAsync(cancellationToken);
        }

        public async Task<(IReadOnlyList<TodoItem> Items, int TotalCount)> GetPagedWithIncludesAsync(
            Expression<Func<TodoItem, bool>> predicate,
            int pageNumber,
            int pageSize,
            bool sortCompletedByCompletionTime,
            Guid? viewerId,
            CancellationToken cancellationToken = default)
        {
            var (safePageNumber, safePageSize) = PaginationParameters.Normalize(pageNumber, pageSize);
            var query = DbSet
                .AsNoTracking()
                .Where(predicate)
                .Where(t => !t.IsDeleted);

            var totalCount = await query.CountAsync(cancellationToken);

            if (!sortCompletedByCompletionTime)
            {
                if (viewerId is Guid activeViewerId)
                {
                    var preferences = Context.Set<UserTodoViewPreference>();
                    // Capture a UTC parameter: DueDate is timestamptz, and today's entire UTC day is urgent.
                    var nextUtcDay = _timeProvider.GetUtcNow().UtcDateTime.Date.AddDays(1);
                    query = query
                        .Select(x => new
                        {
                            Todo = x,
                            IsHidden = (x.UserId == activeViewerId && x.Hidden)
                                || ((x.IsPublic || x.SharedWith.Any()) && preferences.Any(p =>
                                    p.ViewerId == activeViewerId && p.TodoItemId == x.Id && p.HiddenByViewer))
                        })
                        .OrderBy(x => x.Todo.Status != TodoStatus.Done
                            && (x.Todo.Priority == TodoPriority.Urgent
                                || (x.Todo.DueDate.HasValue && x.Todo.DueDate.Value < nextUtcDay))
                                ? 0
                                : x.Todo.Priority == TodoPriority.High
                                    ? 1
                                    : x.Todo.IsPublic || x.Todo.SharedWith.Any() ? 2 : 3)
                        .ThenBy(x => x.IsHidden)
                        .ThenByDescending(x => x.Todo.UserId == activeViewerId
                            ? x.Todo.Status == TodoStatus.InProgress
                            : x.Todo.Workers.Any(w => w.UserId == activeViewerId))
                        .ThenBy(x => x.Todo.DueDate == null)
                        .ThenBy(x => x.Todo.DueDate)
                        .ThenByDescending(x => x.Todo.Priority)
                        .ThenByDescending(x => x.Todo.CreatedAt)
                        .ThenBy(x => x.Todo.Id)
                        .Select(x => x.Todo);
                }
                else
                {
                    query = query.OrderByDescending(x => x.CreatedAt).ThenBy(x => x.Id);
                }
            }
            else if (viewerId is Guid completedViewerId)
            {
                // A friend's task the viewer completed only for themselves has no CompletedAt (its
                // owner has not closed it), so it sorts by the viewer's own completion time: a
                // correlated scalar subquery inside one COALESCE, still ordered and paged in SQL.
                var preferences = Context.Set<UserTodoViewPreference>();
                query = query
                    .OrderByDescending(x => x.CompletedAt
                        ?? preferences
                            .Where(p => p.ViewerId == completedViewerId && p.TodoItemId == x.Id && p.CompletedByViewer)
                            .Select(p => p.CompletedByViewerAt)
                            .FirstOrDefault()
                        ?? x.UpdatedAt
                        ?? x.CreatedAt)
                    .ThenByDescending(x => x.UpdatedAt ?? x.CreatedAt)
                    .ThenByDescending(x => x.CreatedAt);
            }
            else
            {
                query = query
                    .OrderByDescending(x => x.CompletedAt ?? x.UpdatedAt ?? x.CreatedAt)
                    .ThenByDescending(x => x.UpdatedAt ?? x.CreatedAt)
                    .ThenByDescending(x => x.CreatedAt);
            }

            var items = await query
                .Skip((safePageNumber - 1) * safePageSize)
                .Take(safePageSize)
                .Include(t => t.Tags)
                .Include(t => t.SharedWith)
                .Include(t => t.Workers)
                .AsSplitQuery()
                .ToListAsync(cancellationToken);

            return (items, totalCount);
        }

        public async Task<IReadOnlyList<TodoItem>> GetSubtasksAsync(Guid parentTodoId, CancellationToken cancellationToken = default)
        {
            return await DbSet
                .AsNoTracking()
                .AsSplitQuery()
                .Where(t => t.ParentTodoId == parentTodoId && !t.IsDeleted)
                .OrderBy(t => t.CreatedAt)
                .Include(t => t.Tags)
                .Include(t => t.SharedWith)
                .Include(t => t.Workers)
                .ToListAsync(cancellationToken);
        }

        public async Task<IReadOnlyList<TodoItem>> GetSubtasksTrackedAsync(Guid parentTodoId, CancellationToken cancellationToken = default)
        {
            return await DbSet
                .AsSplitQuery()
                .Where(t => t.ParentTodoId == parentTodoId && !t.IsDeleted)
                .OrderBy(t => t.CreatedAt)
                .Include(t => t.Tags)
                .Include(t => t.SharedWith)
                .Include(t => t.Workers)
                .ToListAsync(cancellationToken);
        }

        public async Task<int> GetActiveWorkerTaskCountAsync(Guid userId, CancellationToken cancellationToken = default)
        {
            return await DbSet
                .AsNoTracking()
                .CountAsync(
                    t => !t.IsDeleted &&
                         t.Status != TodoStatus.Done &&
                         t.Workers.Any(w => w.UserId == userId),
                    cancellationToken);
        }

        public async Task<bool> AreAllSubtasksCompletedAsync(Guid parentTodoId, CancellationToken cancellationToken = default)
        {
            // No open child remaining ⇒ all done (vacuously true when there are no subtasks).
            return !await DbSet
                .AsNoTracking()
                .AnyAsync(
                    t => t.ParentTodoId == parentTodoId && !t.IsDeleted && t.Status != TodoStatus.Done,
                    cancellationToken);
        }

        public async Task<IReadOnlyList<TodoFriendShareKey>> GetFriendShareKeysAsync(
            Expression<Func<TodoItem, bool>> predicate,
            Guid userId,
            IReadOnlyCollection<Guid> friendIds,
            CancellationToken cancellationToken = default)
        {
            return await DbSet.AsNoTracking()
                .Where(predicate)
                .SelectMany(todo => todo.SharedWith.Where(share =>
                        (todo.UserId == userId && friendIds.Contains(share.SharedWithUserId)) ||
                        (friendIds.Contains(todo.UserId) && share.SharedWithUserId == userId)),
                    (todo, share) => new TodoFriendShareKey(
                        todo.Id, todo.UserId, todo.UpdatedAt ?? todo.CreatedAt, share.SharedWithUserId))
                .ToListAsync(cancellationToken);
        }

        public async Task<IReadOnlyList<TodoCategoryKey>> GetCategoryKeysAsync(
            Expression<Func<TodoItem, bool>> predicate,
            CancellationToken cancellationToken = default)
        {
            return await DbSet
                .AsNoTracking()
                .Where(predicate)
                .Select(t => new TodoCategoryKey(t.Id, t.UserId, t.CategoryId))
                .ToListAsync(cancellationToken);
        }

        public async Task<IReadOnlyDictionary<Guid, int>> GetOpenSubtaskCountsAsync(
            IReadOnlyCollection<Guid> parentTodoIds,
            CancellationToken cancellationToken = default)
        {
            if (parentTodoIds.Count == 0)
                return new Dictionary<Guid, int>();

            // One grouped count over ix_todo_items_parent_deleted_created. Only open children are
            // counted; parents whose every subtask is done (or who have none) drop out of the GROUP BY
            // and are absent from the map — callers read a missing key as 0.
            var grouped = await DbSet
                .AsNoTracking()
                .Where(t => t.ParentTodoId != null
                    && parentTodoIds.Contains(t.ParentTodoId.Value)
                    && !t.IsDeleted
                    && t.Status != TodoStatus.Done)
                .GroupBy(t => t.ParentTodoId!.Value)
                .Select(g => new { ParentId = g.Key, Count = g.Count() })
                .ToListAsync(cancellationToken);

            return grouped.ToDictionary(x => x.ParentId, x => x.Count);
        }

        public async Task RemoveSharesBetweenUsersAsync(Guid userId, Guid friendId, CancellationToken cancellationToken = default)
        {
            // Every share row in either direction between the two users, loaded and
            // removed under a single SaveChangesAsync so the cleanup is atomic (both
            // directions succeed or fail together) and provider-agnostic — the EF Core
            // InMemory test provider does not support ExecuteDeleteAsync.
            var shares = await Context.TodoItemShares
                .Where(s =>
                    (s.SharedWithUserId == friendId &&
                     Context.TodoItems.Any(t => t.Id == s.TodoItemId && t.UserId == userId)) ||
                    (s.SharedWithUserId == userId &&
                     Context.TodoItems.Any(t => t.Id == s.TodoItemId && t.UserId == friendId)))
                .ToListAsync(cancellationToken);

            if (shares.Count == 0)
            {
                return;
            }

            Context.TodoItemShares.RemoveRange(shares);
            await Context.SaveChangesAsync(cancellationToken);
        }

        public async Task<int> RemoveUserFromOthersTodosAsync(Guid userId, CancellationToken cancellationToken = default)
        {
            // Loaded and removed rather than ExecuteDelete, so the consumer's single SaveChangesAsync
            // commits them together with the soft-delete of the account's own tasks, and so the
            // InMemory test provider can run it. A deleted account's own tasks take their shares,
            // workers and preferences with them when they are purged; these are the rows it left on
            // tasks that belong to someone else, which nothing else ever removed.
            var shares = await Context.TodoItemShares
                .Where(s => s.SharedWithUserId == userId)
                .ToListAsync(cancellationToken);
            var workers = await Context.Set<TodoItemWorker>()
                .Where(w => w.UserId == userId)
                .ToListAsync(cancellationToken);
            var preferences = await Context.UserTodoViewPreferences
                .Where(p => p.ViewerId == userId)
                .ToListAsync(cancellationToken);

            Context.TodoItemShares.RemoveRange(shares);
            Context.Set<TodoItemWorker>().RemoveRange(workers);
            Context.UserTodoViewPreferences.RemoveRange(preferences);
            return shares.Count + workers.Count + preferences.Count;
        }
    }
}
