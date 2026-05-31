using Planora.BuildingBlocks.Application.Pagination;
using Planora.BuildingBlocks.Infrastructure.Persistence;

namespace Planora.Collaboration.Infrastructure.Persistence.Repositories
{
    public sealed class CommentRepository
        : BaseRepository<Comment, Guid, CollaborationDbContext>, ICommentRepository
    {
        public CommentRepository(CollaborationDbContext context) : base(context) { }

        public override async Task<Comment?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default)
        {
            return await DbSet
                .AsNoTracking()
                .FirstOrDefaultAsync(c => c.Id == id && !c.IsDeleted, cancellationToken);
        }

        public async Task<(IReadOnlyList<Comment> Items, int TotalCount)> GetPagedByTaskIdAsync(
            Guid taskId, int pageNumber, int pageSize, CancellationToken ct = default)
        {
            var (safePageNumber, safePageSize) = PaginationParameters.Normalize(pageNumber, pageSize);

            // Genesis (the task description) is no longer stored here — it is synthesised on
            // read from the live task description (single source of truth in Todo). Any legacy
            // genesis rows from the previous design are excluded so they never double up.
            var query = DbSet
                .AsNoTracking()
                .Where(c => c.TaskId == taskId && !c.IsDeleted && !c.IsGenesisComment);

            var totalCount = await query.CountAsync(ct);

            var items = await query
                .OrderBy(c => c.CreatedAt)
                .Skip((safePageNumber - 1) * safePageSize)
                .Take(safePageSize)
                .ToListAsync(ct);

            return (items, totalCount);
        }

        public async Task SoftDeleteByTaskIdAsync(Guid taskId, Guid deletedBy, CancellationToken ct = default)
        {
            // Load-then-update instead of ExecuteUpdateAsync: works with all EF Core providers
            // including InMemory (used in unit tests). Comment counts per task are bounded, so
            // the extra round-trip is negligible. Changes are flushed by the caller's
            // UnitOfWork.SaveChangesAsync().
            var comments = await DbSet
                .Where(c => c.TaskId == taskId && !c.IsDeleted)
                .ToListAsync(ct);

            foreach (var comment in comments)
                comment.MarkAsDeleted(deletedBy);
        }
    }
}
