using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Planora.BuildingBlocks.Application.Messaging.Events;
using Planora.BuildingBlocks.Application.Outbox;
using Planora.BuildingBlocks.Infrastructure.Retention;
using Planora.Todo.Domain.Entities;
using Planora.Todo.Domain.Enums;
using Planora.Todo.Domain.Repositories;

namespace Planora.Todo.Infrastructure.Retention
{
    /// <summary>
    /// Auto-deletes tasks that have sat completed longer than <see cref="RetentionOptions.CompletedTaskDays"/>
    /// (default 30). Deletion goes through the same <b>soft-delete + integration-event cascade</b> as a
    /// manual delete — not a raw purge — so the task's Collaboration comment timeline and its Realtime
    /// notifications are cleaned up, and the row still gets the standard soft-delete grace window (the
    /// <c>TodoSoftDeletePurgePolicy</c> physically removes it later) as a safety net.
    /// </summary>
    /// <remarks>
    /// Only branch roots (<c>ParentTodoId == null</c>) are candidates; deleting a root cascades to every
    /// subtask regardless of its status, so a whole branch dies together (decision #3). For shared/public
    /// tasks the owner's global completion dominates every holder's view, so "delete once every holder has
    /// held it completed for 30 days" reduces exactly to "the owner completed it ≥30 days ago" — no need to
    /// enumerate the (dynamic) friend audience. Per-holder <em>hiding</em> for the owner-not-yet-done case
    /// is handled separately by <see cref="TodoCompletedViewerHidePolicy"/>.
    /// </remarks>
    public sealed class CompletedTodoPolicy : IRetentionPolicy
    {
        // Auto-deletion has no human actor; Guid.Empty is the system/sentinel author on the soft-delete
        // audit columns and the cascade events.
        private static readonly Guid SystemActorId = Guid.Empty;

        private readonly IRetentionLock _lock;
        private readonly ILogger<CompletedTodoPolicy> _logger;

        public CompletedTodoPolicy(IRetentionLock retentionLock, ILogger<CompletedTodoPolicy> logger)
        {
            _lock = retentionLock;
            _logger = logger;
        }

        public string Name => "completed-todo-delete";

        public bool IsEnabled(RetentionOptions options) => options.PurgeCompletedTasks;

        public Task<RetentionResult> ExecuteAsync(
            IServiceProvider scopedServices,
            RetentionContext context,
            CancellationToken cancellationToken)
        {
            var db = scopedServices.GetRequiredService<DbContext>();
            var repository = scopedServices.GetRequiredService<ITodoRepository>();
            var outbox = scopedServices.GetRequiredService<IOutboxRepository>();
            var cutoff = context.UtcNow.AddDays(-context.Options.CompletedTaskDays);

            return RetentionExecutor.RunAsync(
                Name, db, _lock, context,
                ct => db.Set<TodoItem>()
                    .CountAsync(t => t.Status == TodoStatus.Done && t.CompletedAt < cutoff
                                     && !t.IsDeleted && t.ParentTodoId == null, ct),
                (batch, ct) => SoftDeleteBatchAsync(db, repository, outbox, cutoff, batch, ct),
                _logger, cancellationToken);
        }

        private static async Task<int> SoftDeleteBatchAsync(
            DbContext db, ITodoRepository repository, IOutboxRepository outbox,
            DateTime cutoff, int batchSize, CancellationToken ct)
        {
            var roots = await db.Set<TodoItem>()
                .Where(t => t.Status == TodoStatus.Done && t.CompletedAt < cutoff
                            && !t.IsDeleted && t.ParentTodoId == null)
                .OrderBy(t => t.CompletedAt)
                .Take(batchSize)
                .ToListAsync(ct);

            if (roots.Count == 0)
                return 0;

            foreach (var root in roots)
            {
                root.MarkAsDeleted(SystemActorId);

                // Whole branch dies together — soft-delete every subtask regardless of status.
                var subtasks = await repository.GetSubtasksTrackedAsync(root.Id, ct);
                foreach (var subtask in subtasks)
                    subtask.MarkAsDeleted(SystemActorId);

                // Same cascade a manual delete fires: Collaboration drops the comment timeline and
                // RealtimeApi drops the notifications. AddAsync commits the tracked soft-deletes and the
                // outbox row together, so each task is soft-deleted atomically with its deletion fact.
                await EnqueueTaskDeletedAsync(outbox, root.Id, ct);
            }

            return roots.Count;
        }

        private static Task EnqueueTaskDeletedAsync(IOutboxRepository outbox, Guid taskId, CancellationToken ct)
        {
            var @event = new TaskDeletedIntegrationEvent(taskId, SystemActorId);
            var message = new OutboxMessage(
                @event.GetType().AssemblyQualifiedName ?? @event.GetType().Name,
                JsonSerializer.Serialize(@event, @event.GetType()),
                DateTime.UtcNow);
            return outbox.AddAsync(message, ct);
        }
    }

    /// <summary>
    /// The per-holder half of the shared-task rule (decision #2): when a task's owner has <b>not</b> closed
    /// it globally but a viewer marked it done for themselves, it leaves that viewer's lists once their
    /// personal completion is older than <see cref="RetentionOptions.CompletedTaskDays"/> — the same window,
    /// counted from the same moment, as the "deletes in N days" badge the archive shows them (the list read
    /// reports that moment as the task's <c>completedAt</c> for this viewer). The task stays alive for the
    /// owner; if the owner later completes it globally, <see cref="CompletedTodoPolicy"/> deletes it for
    /// everyone.
    /// </summary>
    /// <remarks>
    /// The marker is the per-viewer hide flag. A hidden shared task is excluded from the completed archive
    /// before counting and paging, and a viewer-completed one never appears among active tasks, so the
    /// task is gone from every list of this viewer — never shown as a "Hidden task" placeholder. A personal
    /// completion with no timestamp has no age to measure; it is treated as expired rather than kept forever.
    /// </remarks>
    public sealed class TodoCompletedViewerHidePolicy : IRetentionPolicy
    {
        private readonly IRetentionLock _lock;
        private readonly ILogger<TodoCompletedViewerHidePolicy> _logger;

        public TodoCompletedViewerHidePolicy(IRetentionLock retentionLock, ILogger<TodoCompletedViewerHidePolicy> logger)
        {
            _lock = retentionLock;
            _logger = logger;
        }

        public string Name => "completed-todo-viewer-hide";

        public bool IsEnabled(RetentionOptions options) => options.PurgeCompletedTasks;

        public Task<RetentionResult> ExecuteAsync(
            IServiceProvider scopedServices,
            RetentionContext context,
            CancellationToken cancellationToken)
        {
            var db = scopedServices.GetRequiredService<DbContext>();
            var cutoff = context.UtcNow.AddDays(-context.Options.CompletedTaskDays);

            // A preference row is hide-eligible when the viewer personally completed the task ≥ cutoff ago
            // (or at an unknown time), hasn't already hidden it, and the underlying task is still alive and
            // NOT globally completed (a globally-completed task is handled by CompletedTodoPolicy, which
            // deletes it for all).
            System.Linq.Expressions.Expression<Func<UserTodoViewPreference, bool>> eligible =
                p => p.CompletedByViewer
                     && (p.CompletedByViewerAt == null || p.CompletedByViewerAt < cutoff)
                     && !p.HiddenByViewer
                     && db.Set<TodoItem>().Any(t => t.Id == p.TodoItemId && !t.IsDeleted && t.Status != TodoStatus.Done);

            return RetentionExecutor.RunAsync(
                Name, db, _lock, context,
                ct => db.Set<UserTodoViewPreference>().CountAsync(eligible, ct),
                // Set-based hide in one statement (bounded by the tripwire). The second pass matches
                // nothing because HiddenByViewer is now true, so the executor's loop terminates.
                (batch, ct) => db.Set<UserTodoViewPreference>().Where(eligible)
                    .ExecuteUpdateAsync(s => s.SetProperty(p => p.HiddenByViewer, true), ct),
                _logger, cancellationToken);
        }
    }

    /// <summary>
    /// Ends the participation of a friend who has finished their part. A viewer who marks a friend's task
    /// done for themselves is no longer working on it (the status path always removed their worker row;
    /// the viewer-preference path the UI uses did not, until October 2026). Such a row left them listed as
    /// working on the owner's task indefinitely — and once their completion expired and the task left their
    /// lists, they had no way left to leave it. This removes the worker row of every viewer whose personal
    /// completion is recorded on a live top-level task, whatever its age; new completions remove it at once.
    /// </summary>
    public sealed class TodoCompletedViewerReleasePolicy : IRetentionPolicy
    {
        private readonly IRetentionLock _lock;
        private readonly ILogger<TodoCompletedViewerReleasePolicy> _logger;

        public TodoCompletedViewerReleasePolicy(IRetentionLock retentionLock, ILogger<TodoCompletedViewerReleasePolicy> logger)
        {
            _lock = retentionLock;
            _logger = logger;
        }

        public string Name => "completed-todo-viewer-release";

        public bool IsEnabled(RetentionOptions options) => options.PurgeCompletedTasks;

        public Task<RetentionResult> ExecuteAsync(
            IServiceProvider scopedServices,
            RetentionContext context,
            CancellationToken cancellationToken)
        {
            var db = scopedServices.GetRequiredService<DbContext>();

            // The worker belongs to a viewer who completed the task for themselves, and the task is a
            // live branch root (subtask completion is global and has no per-viewer state).
            System.Linq.Expressions.Expression<Func<TodoItemWorker, bool>> eligible =
                w => db.Set<UserTodoViewPreference>().Any(p =>
                         p.ViewerId == w.UserId && p.TodoItemId == w.TodoItemId && p.CompletedByViewer)
                     && db.Set<TodoItem>().Any(t =>
                         t.Id == w.TodoItemId && !t.IsDeleted && t.ParentTodoId == null && t.UserId != w.UserId);

            return RetentionExecutor.RunAsync(
                Name, db, _lock, context,
                ct => db.Set<TodoItemWorker>().CountAsync(eligible, ct),
                // Set-based delete in one statement (bounded by the tripwire); the second pass matches
                // nothing, so the executor's loop terminates.
                (batch, ct) => db.Set<TodoItemWorker>().Where(eligible).ExecuteDeleteAsync(ct),
                _logger, cancellationToken);
        }
    }
}
