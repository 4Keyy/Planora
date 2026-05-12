using Planora.BuildingBlocks.Application.Pagination;
using Planora.BuildingBlocks.Infrastructure.Persistence;
using Planora.Todo.Domain.Repositories;

namespace Planora.Todo.Infrastructure.Persistence.Repositories
{
    public sealed class TodoCommentRepository
        : BaseRepository<TodoItemComment, Guid, TodoDbContext>, ITodoCommentRepository
    {
        public TodoCommentRepository(TodoDbContext context) : base(context) { }

        public override async Task<TodoItemComment?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default)
        {
            return await DbSet
                .AsNoTracking()
                .FirstOrDefaultAsync(c => c.Id == id && !c.IsDeleted, cancellationToken);
        }

        public async Task<(IReadOnlyList<TodoItemComment> Items, int TotalCount)> GetPagedByTodoIdAsync(
            Guid todoItemId, int pageNumber, int pageSize, CancellationToken ct = default)
        {
            var (safePageNumber, safePageSize) = PaginationParameters.Normalize(pageNumber, pageSize);

            var query = DbSet
                .AsNoTracking()
                .Where(c => c.TodoItemId == todoItemId && !c.IsDeleted);

            var totalCount = await query.CountAsync(ct);

            var items = await query
                .OrderBy(c => c.CreatedAt)
                .Skip((safePageNumber - 1) * safePageSize)
                .Take(safePageSize)
                .ToListAsync(ct);

            return (items, totalCount);
        }

        public async Task SoftDeleteByTodoIdAsync(Guid todoItemId, Guid deletedBy, CancellationToken ct = default)
        {
            var comments = await DbSet
                .Where(c => c.TodoItemId == todoItemId && !c.IsDeleted)
                .ToListAsync(ct);

            foreach (var comment in comments)
                comment.MarkAsDeleted(deletedBy);
        }
    }
}
