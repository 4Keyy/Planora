using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Planora.BuildingBlocks.Infrastructure.Retention;
using Planora.Todo.Domain.Entities;

namespace Planora.Todo.Infrastructure.Retention
{
    /// <summary>
    /// TodoApi's soft-delete purge. Behaves like the generic <c>SoftDeletedPurgePolicy&lt;TodoItem&gt;</c> but
    /// additionally cleans the per-viewer <see cref="UserTodoViewPreference"/> rows, which have <b>no</b>
    /// foreign key / cascade to <c>todo_items</c> and would otherwise be orphaned by a physical delete.
    /// Rows that DO have a database cascade (shares, workers, tags) are removed by PostgreSQL automatically.
    /// </summary>
    /// <remarks>
    /// Subtasks are purged before their parents: the self-referencing <c>ParentTodoId</c> FK is
    /// <c>NO ACTION</c>, and although a parent + its children are always soft-deleted together (a subtask
    /// cannot be added under a deleted parent, so "parent soft-deleted ⇒ children soft-deleted" holds),
    /// ordering children first guarantees no parent row is deleted across a batch boundary while a child
    /// still references it.
    /// </remarks>
    public sealed class TodoSoftDeletePurgePolicy : IRetentionPolicy
    {
        private readonly IRetentionLock _lock;
        private readonly ILogger<TodoSoftDeletePurgePolicy> _logger;

        public TodoSoftDeletePurgePolicy(IRetentionLock retentionLock, ILogger<TodoSoftDeletePurgePolicy> logger)
        {
            _lock = retentionLock;
            _logger = logger;
        }

        public string Name => "soft-delete-purge:TodoItem";

        public bool IsEnabled(RetentionOptions options) => options.PurgeSoftDeleted;

        public async Task<RetentionResult> ExecuteAsync(
            IServiceProvider scopedServices,
            RetentionContext context,
            CancellationToken cancellationToken)
        {
            var db = scopedServices.GetRequiredService<DbContext>();
            var cutoff = context.UtcNow.AddDays(-context.Options.SoftDeleteGraceDays);

            return await RetentionExecutor.RunAsync(
                Name,
                db,
                _lock,
                context,
                ct => db.Set<TodoItem>().IgnoreQueryFilters()
                    .CountAsync(t => t.IsDeleted && t.DeletedAt < cutoff, ct),
                (batch, ct) => DeleteBatchAsync(db, cutoff, batch, ct),
                _logger,
                cancellationToken);
        }

        private static async Task<int> DeleteBatchAsync(DbContext db, DateTime cutoff, int batchSize, CancellationToken ct)
        {
            var ids = await db.Set<TodoItem>().IgnoreQueryFilters()
                .Where(t => t.IsDeleted && t.DeletedAt < cutoff)
                // Children (ParentTodoId != null) first, so a parent is never deleted in an earlier
                // batch than a child that still references it (NO ACTION self-FK).
                .OrderByDescending(t => t.ParentTodoId != null)
                .ThenBy(t => t.DeletedAt)
                .Select(t => t.Id)
                .Take(batchSize)
                .ToListAsync(ct);

            if (ids.Count == 0)
                return 0;

            // Orphan cleanup first — user_todo_view_preferences has no FK/cascade to todo_items.
            await db.Set<UserTodoViewPreference>()
                .Where(p => ids.Contains(p.TodoItemId))
                .ExecuteDeleteAsync(ct);

            // The todo rows themselves; shares / workers / tags fall away via their cascade FKs.
            return await db.Set<TodoItem>().IgnoreQueryFilters()
                .Where(t => ids.Contains(t.Id))
                .ExecuteDeleteAsync(ct);
        }
    }
}
