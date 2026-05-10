using Planora.BuildingBlocks.Infrastructure.Persistence;
using Planora.Todo.Domain.Enums;
using Planora.BuildingBlocks.Application.Pagination;
using System.Linq.Expressions;

namespace Planora.Todo.Infrastructure.Persistence.Repositories
{
    public sealed class TodoRepository : BaseRepository<TodoItem, Guid, TodoDbContext>, ITodoRepository
    {
        public TodoRepository(TodoDbContext context)
            : base(context)
        {
        }

        public async Task<IReadOnlyList<TodoItem>> GetByUserIdAsync(Guid userId, CancellationToken cancellationToken = default)
        {
            return await DbSet
                .AsNoTracking()
                .Where(t => t.UserId == userId)
                .OrderByDescending(t => t.CreatedAt)
                .ToListAsync(cancellationToken);
        }

        public async Task<IReadOnlyList<TodoItem>> GetActiveByUserIdAsync(Guid userId, CancellationToken cancellationToken = default)
        {
            return await DbSet
                .AsNoTracking()
                .Where(t => t.UserId == userId && t.Status != TodoStatus.Done)
                .OrderBy(t => t.ExpectedDate ?? t.CreatedAt)
                .ToListAsync(cancellationToken);
        }

        public async Task<IReadOnlyList<TodoItem>> GetCompletedByUserIdAsync(Guid userId, CancellationToken cancellationToken = default)
        {
            return await DbSet
                .AsNoTracking()
                .Where(t => t.UserId == userId && t.Status == TodoStatus.Done)
                .OrderByDescending(t => t.UpdatedAt)
                .ToListAsync(cancellationToken);
        }

        public async Task<IReadOnlyList<TodoItem>> GetByUserIdAndCategoryIdAsync(Guid userId, Guid categoryId, CancellationToken cancellationToken = default)
        {
            return await DbSet
                .AsNoTracking()
                .Where(t => t.UserId == userId && t.CategoryId == categoryId)
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
                .CountAsync(t => t.UserId == userId && t.Status != TodoStatus.Done, cancellationToken);
        }

        public async Task<IReadOnlyList<TodoItem>> GetOverdueAsync(Guid userId, CancellationToken cancellationToken = default)
        {
            return await DbSet
                .AsNoTracking()
                .Where(t => t.UserId == userId && t.Status != TodoStatus.Done && t.ExpectedDate.HasValue && t.ExpectedDate.Value < DateTime.UtcNow)
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
                .ToListAsync(cancellationToken);
        }

        public async Task<(IReadOnlyList<TodoItem> Items, int TotalCount)> GetPagedWithIncludesAsync(
            Expression<Func<TodoItem, bool>> predicate,
            int pageNumber,
            int pageSize,
            bool sortCompletedByCompletionTime,
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
                    .OrderByDescending(x => x.CompletedAt ?? x.UpdatedAt ?? x.CreatedAt)
                    .ThenByDescending(x => x.UpdatedAt ?? x.CreatedAt)
                    .ThenByDescending(x => x.CreatedAt)
                : query.OrderByDescending(x => x.CreatedAt);

            var items = await query
                .Skip((safePageNumber - 1) * safePageSize)
                .Take(safePageSize)
                .Include(t => t.Tags)
                .Include(t => t.SharedWith)
                .AsSplitQuery()
                .ToListAsync(cancellationToken);

            return (items, totalCount);
        }
    }
}
