using Planora.BuildingBlocks.Application.Pagination;
using Planora.BuildingBlocks.Infrastructure.Persistence;
using Planora.Collaboration.Domain.Enums;

namespace Planora.Collaboration.Infrastructure.Persistence.Repositories
{
    public sealed class CommentRepository
        : BaseRepository<Comment, Guid, CollaborationDbContext>, ICommentRepository
    {
        public CommentRepository(CollaborationDbContext context) : base(context) { }

        // GetByIdAsync intentionally inherits the tracking base implementation. The Comment
        // aggregate uses PostgreSQL's `xmin` as an optimistic-concurrency token, which is a
        // shadow property captured only on a *tracked* read. An AsNoTracking load drops it,
        // so the subsequent UPDATE issues `WHERE xmin = 0`, matches no rows, and every edit
        // or delete fails with a spurious DbUpdateConcurrencyException. The base already
        // applies the `!IsDeleted` predicate, so no override is needed here.

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

        public async Task<int> SoftDeleteByAuthorAsync(Guid authorId, Guid deletedBy, CancellationToken ct = default)
        {
            // Tracked load (NOT AsNoTracking) so the xmin concurrency token is captured — otherwise
            // the UPDATE issues `WHERE xmin = 0`, matches no rows, and the cleanup fails with a
            // spurious DbUpdateConcurrencyException. Mirrors SoftDeleteByTaskIdAsync; the caller's
            // UnitOfWork.SaveChangesAsync flushes the changes.
            var comments = await DbSet
                .Where(c => c.AuthorId == authorId && !c.IsDeleted)
                .ToListAsync(ct);

            foreach (var comment in comments)
                comment.MarkAsDeleted(deletedBy);

            return comments.Count;
        }

        public async Task SoftDeleteSubtaskActivityAsync(
            Guid parentTaskId, string subtaskTitle, Guid deletedBy, CancellationToken ct = default)
        {
            var title = (subtaskTitle ?? string.Empty).Trim();
            if (title.Length == 0)
                return;

            // The activity consumer writes deterministic sentences ending with the subtask title,
            // e.g. "Ann added a subtask: Buy milk". Match those exact suffixes within the parent's
            // branch so we never touch a regular comment or a different subtask's announcement.
            var addedSuffix = $"added a subtask: {title}";
            var completedSuffix = $"completed a subtask: {title}";

            // Load-then-update keeps parity with SoftDeleteByTaskIdAsync (InMemory-friendly).
            var comments = await DbSet
                .Where(c => c.TaskId == parentTaskId && c.IsSystemComment && !c.IsDeleted &&
                            (c.Content.EndsWith(addedSuffix) || c.Content.EndsWith(completedSuffix)))
                .ToListAsync(ct);

            foreach (var comment in comments)
                comment.MarkAsDeleted(deletedBy);
        }

        public async Task<IReadOnlyDictionary<Guid, Comment>> GetLiveByIdsAsync(
            Guid taskId, IReadOnlyCollection<Guid> commentIds, CancellationToken ct = default)
        {
            if (commentIds.Count == 0)
                return new Dictionary<Guid, Comment>();

            // One indexed lookup for the whole page (PK + TaskId guard) — the TaskId predicate
            // keeps a forged id from ever surfacing another branch's content.
            var items = await DbSet
                .AsNoTracking()
                .Where(c => c.TaskId == taskId && !c.IsDeleted && commentIds.Contains(c.Id))
                .ToListAsync(ct);

            return items.ToDictionary(c => c.Id);
        }

        public async Task MarkSubtaskReplyTargetsDeletedAsync(
            Guid parentTaskId, Guid subtaskId, CancellationToken ct = default)
        {
            // Load-then-update keeps parity with the other cascade helpers (InMemory-friendly);
            // replies quoting one subtask are bounded per branch.
            var replies = await DbSet
                .Where(c => c.TaskId == parentTaskId && !c.IsDeleted &&
                            c.ReplyToType == ReplyTargetType.Subtask &&
                            c.ReplyToId == subtaskId && !c.ReplyToDeleted)
                .ToListAsync(ct);

            foreach (var reply in replies)
                reply.MarkReplyTargetDeleted();
        }
    }
}
