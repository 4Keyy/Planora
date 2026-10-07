using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Planora.BuildingBlocks.Application.Outbox;
using Planora.BuildingBlocks.Infrastructure.Retention;
using Planora.BuildingBlocks.Infrastructure.Retention.Policies;
using Planora.Todo.Domain.Entities;
using Planora.Todo.Domain.Repositories;
using Planora.Todo.Infrastructure.Persistence;
using Planora.Todo.Infrastructure.Persistence.Repositories;
using Planora.Todo.Infrastructure.Retention;
using static Planora.UnitTests.BuildingBlocks.Retention.Postgres.RetentionTestKit;

namespace Planora.UnitTests.BuildingBlocks.Retention.Postgres;

/// <summary>
/// TodoApi's retention, live on PostgreSQL: completed branches are soft-deleted with their deletion
/// fact queued, soft-deleted branches are physically purged past the grace window (children before
/// parents, viewer rows with them), stale personal completions are hidden, and spent outbox rows go.
/// </summary>
[Trait("TestType", "Integration")]
public sealed class TodoRetentionPostgresTests
{
    private static readonly Guid Owner = Guid.NewGuid();
    private static readonly Guid Friend = Guid.NewGuid();

    private static async Task<(TemporaryDatabase Database, ServiceProvider Services)> CreateAsync()
    {
        var database = await TemporaryDatabase.CreateAsync();
        var services = new ServiceCollection();
        services.AddScoped(_ => new TodoDbContext(database.Options<TodoDbContext>()));
        services.AddScoped<DbContext>(sp => sp.GetRequiredService<TodoDbContext>());
        services.AddScoped<ITodoRepository, TodoRepository>();
        services.AddScoped<IOutboxRepository, OutboxRepository>();
        var provider = services.BuildServiceProvider();

        await using var scope = provider.CreateAsyncScope();
        await scope.ServiceProvider.GetRequiredService<TodoDbContext>().Database.EnsureCreatedAsync();
        return (database, provider);
    }

    private static TodoItem CompletedRoot(string title, DateTime completedAt, IEnumerable<Guid>? sharedWith = null)
    {
        var todo = TodoItem.Create(Owner, title, sharedWithUserIds: sharedWith);
        todo.MarkAsDone(Owner);
        Set(todo, nameof(TodoItem.CompletedAt), completedAt);
        return todo;
    }

    private static void Delete(TodoItem todo, DateTime deletedAt)
    {
        todo.MarkAsDeleted(Owner);
        Set(todo, nameof(TodoItem.DeletedAt), deletedAt);
    }

    [PostgresFact]
    public async Task CompletedPolicy_SoftDeletesOldCompletedBranches_AndQueuesTheirDeletion()
    {
        var (database, provider) = await CreateAsync();
        await using var _ = database;
        await using var __ = provider;
        var now = DateTime.UtcNow;

        Guid parentId, subtaskId, loneId, thirdId, recentId, openId;
        await using (var scope = provider.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<TodoDbContext>();
            var parent = CompletedRoot("old branch", now.AddDays(-45), sharedWith: new[] { Friend });
            parent.AddTag("errands", Owner);
            var subtask = TodoItem.CreateSubtask(parent, Owner, "still open step", null);
            var lone = CompletedRoot("old single", now.AddDays(-40));
            var third = CompletedRoot("old third", now.AddDays(-31));
            var recent = CompletedRoot("recent", now.AddDays(-10));
            var open = TodoItem.Create(Owner, "open");
            db.AddRange(parent, subtask, lone, third, recent, open);
            await db.SaveChangesAsync();
            (parentId, subtaskId, loneId, thirdId, recentId, openId) = (parent.Id, subtask.Id, lone.Id, third.Id, recent.Id, open.Id);
        }

        RetentionResult result;
        await using (var scope = provider.CreateAsyncScope())
        {
            var policy = new CompletedTodoPolicy(new PostgresRetentionLock(), NullLogger<CompletedTodoPolicy>.Instance);
            result = await RunAsync(policy, scope.ServiceProvider, Live(), now);
        }

        Assert.False(result.DryRun);
        Assert.Equal(3, result.Scanned);
        Assert.Equal(3, result.Deleted);

        await using (var scope = provider.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<TodoDbContext>();
            var deleted = await db.TodoItems.IgnoreQueryFilters().Where(t => t.IsDeleted).Select(t => t.Id).ToListAsync();
            Assert.Equal(new[] { parentId, subtaskId, loneId, thirdId }.OrderBy(x => x), deleted.OrderBy(x => x));

            var alive = await db.TodoItems.IgnoreQueryFilters().Where(t => !t.IsDeleted).Select(t => t.Id).ToListAsync();
            Assert.Equal(new[] { recentId, openId }.OrderBy(x => x), alive.OrderBy(x => x));

            // One deletion fact per branch, so Collaboration and Realtime drop its comments and notifications.
            var queued = await db.OutboxMessages.Where(m => m.Type.Contains("TaskDeletedIntegrationEvent")).ToListAsync();
            Assert.Equal(3, queued.Count);
            Assert.All(new[] { parentId, loneId, thirdId }, id => Assert.Contains(queued, m => m.Content.Contains(id.ToString())));
        }
    }

    [PostgresFact]
    public async Task SoftDeletePurge_RemovesBranchesPastGrace_ChildrenFirst_WithTheirViewerRowsSharesAndTags()
    {
        var (database, provider) = await CreateAsync();
        await using var _ = database;
        await using var __ = provider;
        var now = DateTime.UtcNow;

        Guid recentlyDeletedId, liveId;
        await using (var scope = provider.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<TodoDbContext>();
            var parent = TodoItem.Create(Owner, "deleted branch", sharedWithUserIds: new[] { Friend });
            parent.AddTag("home", Owner);
            var subtask = TodoItem.CreateSubtask(parent, Owner, "step", null);
            var recentlyDeleted = TodoItem.Create(Owner, "deleted yesterday");
            var live = TodoItem.Create(Owner, "live");
            db.AddRange(parent, subtask, recentlyDeleted, live);
            await db.SaveChangesAsync();

            // The friend's per-viewer row has no FK to todo_items: the purge has to remove it itself.
            db.UserTodoViewPreferences.Add(new UserTodoViewPreference { ViewerId = Friend, TodoItemId = parent.Id, HiddenByViewer = true });
            Delete(parent, now.AddDays(-10));
            Delete(subtask, now.AddDays(-10));
            Delete(recentlyDeleted, now.AddDays(-1));
            await db.SaveChangesAsync();
            (recentlyDeletedId, liveId) = (recentlyDeleted.Id, live.Id);
        }

        RetentionResult result;
        await using (var scope = provider.CreateAsyncScope())
        {
            var policy = new TodoSoftDeletePurgePolicy(new PostgresRetentionLock(), NullLogger<TodoSoftDeletePurgePolicy>.Instance);
            // One row per batch: the child must be gone in an earlier batch than its parent (NO ACTION FK).
            result = await RunAsync(policy, scope.ServiceProvider, Live(o => o.BatchSize = 1), now);
        }

        Assert.Equal(2, result.Scanned);
        Assert.Equal(2, result.Deleted);

        await using (var scope = provider.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<TodoDbContext>();
            var remaining = await db.TodoItems.IgnoreQueryFilters().Select(t => t.Id).ToListAsync();
            Assert.Equal(new[] { recentlyDeletedId, liveId }.OrderBy(x => x), remaining.OrderBy(x => x));
            Assert.Empty(await db.UserTodoViewPreferences.ToListAsync());
            Assert.Empty(await db.TodoItemShares.ToListAsync());
            Assert.Equal(0, await CountAsync(db, "todo.todo_tags"));
        }
    }

    [PostgresFact]
    public async Task ViewerHide_HidesOnlyStalePersonalCompletions_OnTasksTheOwnerHasNotClosed()
    {
        var (database, provider) = await CreateAsync();
        await using var _ = database;
        await using var __ = provider;
        var now = DateTime.UtcNow;

        Guid activeId, doneId, otherId;
        await using (var scope = provider.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<TodoDbContext>();
            var active = TodoItem.Create(Owner, "owner still working", sharedWithUserIds: new[] { Friend });
            var done = CompletedRoot("owner closed it", now.AddDays(-5), sharedWith: new[] { Friend });
            var other = TodoItem.Create(Owner, "friend finished it last week", sharedWithUserIds: new[] { Friend });
            db.AddRange(active, done, other);
            await db.SaveChangesAsync();

            db.UserTodoViewPreferences.AddRange(
                new UserTodoViewPreference { ViewerId = Friend, TodoItemId = active.Id, CompletedByViewer = true, CompletedByViewerAt = now.AddDays(-40) },
                new UserTodoViewPreference { ViewerId = Friend, TodoItemId = done.Id, CompletedByViewer = true, CompletedByViewerAt = now.AddDays(-40) },
                new UserTodoViewPreference { ViewerId = Friend, TodoItemId = other.Id, CompletedByViewer = true, CompletedByViewerAt = now.AddDays(-7) });
            await db.SaveChangesAsync();
            (activeId, doneId, otherId) = (active.Id, done.Id, other.Id);
        }

        RetentionResult result;
        await using (var scope = provider.CreateAsyncScope())
        {
            var policy = new TodoCompletedViewerHidePolicy(new PostgresRetentionLock(), NullLogger<TodoCompletedViewerHidePolicy>.Instance);
            result = await RunAsync(policy, scope.ServiceProvider, Live(), now);
        }

        Assert.Equal(1, result.Scanned);
        Assert.Equal(1, result.Deleted);

        await using (var scope = provider.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<TodoDbContext>();
            var hidden = await db.UserTodoViewPreferences.Where(p => p.HiddenByViewer).Select(p => p.TodoItemId).ToListAsync();
            Assert.Equal(new[] { activeId }, hidden);
            Assert.DoesNotContain(doneId, hidden);
            Assert.DoesNotContain(otherId, hidden);
        }
    }

    [PostgresFact]
    public async Task ViewerHide_TreatsAPersonalCompletionWithNoTimeAsExpired()
    {
        // A completion with no timestamp has no age to measure. Kept forever it would sit in the
        // friend's archive with no countdown; treated as expired it leaves on the next pass.
        var (database, provider) = await CreateAsync();
        await using var _ = database;
        await using var __ = provider;
        var now = DateTime.UtcNow;

        Guid undatedId;
        await using (var scope = provider.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<TodoDbContext>();
            var undated = TodoItem.Create(Owner, "completed before completion times were recorded", sharedWithUserIds: new[] { Friend });
            var recent = TodoItem.Create(Owner, "completed yesterday", sharedWithUserIds: new[] { Friend });
            db.AddRange(undated, recent);
            await db.SaveChangesAsync();
            db.UserTodoViewPreferences.AddRange(
                new UserTodoViewPreference { ViewerId = Friend, TodoItemId = undated.Id, CompletedByViewer = true, CompletedByViewerAt = null },
                new UserTodoViewPreference { ViewerId = Friend, TodoItemId = recent.Id, CompletedByViewer = true, CompletedByViewerAt = now.AddDays(-1) });
            await db.SaveChangesAsync();
            undatedId = undated.Id;
        }

        RetentionResult result;
        await using (var scope = provider.CreateAsyncScope())
        {
            var policy = new TodoCompletedViewerHidePolicy(new PostgresRetentionLock(), NullLogger<TodoCompletedViewerHidePolicy>.Instance);
            result = await RunAsync(policy, scope.ServiceProvider, Live(), now);
        }

        Assert.Equal(1, result.Deleted);
        await using (var scope = provider.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<TodoDbContext>();
            var hidden = await db.UserTodoViewPreferences.Where(p => p.HiddenByViewer).Select(p => p.TodoItemId).ToListAsync();
            Assert.Equal(new[] { undatedId }, hidden);
        }
    }

    [PostgresFact]
    public async Task ViewerRelease_EndsTheWorkOfFriendsWhoFinishedTheirPart()
    {
        // The case behind the October 2026 report: a friend joined a shared task, completed it for
        // themselves through the viewer-preference path (which left their worker row), and stayed
        // listed as working on it for months — even after the task had left their own lists.
        var (database, provider) = await CreateAsync();
        await using var _ = database;
        await using var __ = provider;
        var now = DateTime.UtcNow;
        var stillWorking = Guid.NewGuid();

        Guid finishedId, workingId, deletedId;
        await using (var scope = provider.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<TodoDbContext>();
            var finished = TodoItem.Create(Owner, "friend finished their part", sharedWithUserIds: new[] { Friend, stillWorking });
            finished.AddWorker(Friend);
            finished.AddWorker(stillWorking);
            var working = TodoItem.Create(Owner, "friend still working", sharedWithUserIds: new[] { Friend });
            working.AddWorker(Friend);
            var deleted = TodoItem.Create(Owner, "deleted task keeps its rows for the purge", sharedWithUserIds: new[] { Friend });
            deleted.AddWorker(Friend);
            db.AddRange(finished, working, deleted);
            await db.SaveChangesAsync();

            db.UserTodoViewPreferences.AddRange(
                // Finished long ago and already hidden by an earlier pass — still released.
                new UserTodoViewPreference { ViewerId = Friend, TodoItemId = finished.Id, CompletedByViewer = true, CompletedByViewerAt = now.AddDays(-110), HiddenByViewer = true },
                // A preference that is not a completion releases nothing.
                new UserTodoViewPreference { ViewerId = Friend, TodoItemId = working.Id, HiddenByViewer = true },
                new UserTodoViewPreference { ViewerId = Friend, TodoItemId = deleted.Id, CompletedByViewer = true, CompletedByViewerAt = now.AddDays(-1) });
            Delete(deleted, now.AddDays(-1));
            await db.SaveChangesAsync();
            (finishedId, workingId, deletedId) = (finished.Id, working.Id, deleted.Id);
        }

        RetentionResult result;
        await using (var scope = provider.CreateAsyncScope())
        {
            var policy = new TodoCompletedViewerReleasePolicy(new PostgresRetentionLock(), NullLogger<TodoCompletedViewerReleasePolicy>.Instance);
            result = await RunAsync(policy, scope.ServiceProvider, Live(), now);
        }

        Assert.False(result.DryRun);
        Assert.Equal(1, result.Scanned);
        Assert.Equal(1, result.Deleted);

        await using (var scope = provider.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<TodoDbContext>();
            var workers = await db.Set<TodoItemWorker>()
                .Select(w => new { w.TodoItemId, w.UserId })
                .ToListAsync();
            Assert.DoesNotContain(workers, w => w.TodoItemId == finishedId && w.UserId == Friend);
            Assert.Contains(workers, w => w.TodoItemId == finishedId && w.UserId == stillWorking);
            Assert.Contains(workers, w => w.TodoItemId == workingId && w.UserId == Friend);
            Assert.Contains(workers, w => w.TodoItemId == deletedId && w.UserId == Friend);
            // The completion itself, and the owner's task, are untouched.
            Assert.True(await db.UserTodoViewPreferences.AnyAsync(p => p.TodoItemId == finishedId && p.CompletedByViewer));
            Assert.True(await db.TodoItems.AnyAsync(t => t.Id == finishedId && !t.IsDeleted));
        }
    }

    [PostgresFact]
    public async Task ProcessedMessagePurge_RemovesOnlySpentOutboxRows()
    {
        var (database, provider) = await CreateAsync();
        await using var _ = database;
        await using var __ = provider;
        var now = DateTime.UtcNow;

        await using (var scope = provider.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<TodoDbContext>();
            OutboxMessage Processed(DateTime at)
            {
                var m = new OutboxMessage("Evt", "{}", at);
                m.MarkAsProcessed();
                Set(m, nameof(OutboxMessage.ProcessedOnUtc), at);
                return m;
            }

            var deadLettered = new OutboxMessage("Evt", "{}", now.AddDays(-30));
            deadLettered.MarkAsDeadLettered("broker rejected it");
            db.OutboxMessages.AddRange(
                Processed(now.AddDays(-10)), Processed(now.AddDays(-9)), Processed(now.AddDays(-8)),
                Processed(now.AddDays(-2)),
                new OutboxMessage("Evt", "{}", now.AddDays(-30)),
                deadLettered);
            await db.SaveChangesAsync();
        }

        RetentionResult result;
        await using (var scope = provider.CreateAsyncScope())
        {
            var policy = new ProcessedMessagePurgePolicy(new PostgresRetentionLock(), NullLogger<ProcessedMessagePurgePolicy>.Instance);
            result = await RunAsync(policy, scope.ServiceProvider, Live(), now);
        }

        Assert.Equal(3, result.Deleted);
        await using (var scope = provider.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<TodoDbContext>();
            Assert.Equal(3, await db.OutboxMessages.CountAsync());
        }
    }

    [PostgresFact]
    public async Task DeletedAccount_LeavesNothingOnOtherPeoplesTasks()
    {
        var (database, provider) = await CreateAsync();
        await using var _ = database;
        await using var __ = provider;

        Guid taskId;
        await using (var scope = provider.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<TodoDbContext>();
            var task = TodoItem.Create(Owner, "shared with the friend who deletes their account", sharedWithUserIds: new[] { Friend });
            task.AddWorker(Friend);
            db.TodoItems.Add(task);
            await db.SaveChangesAsync();
            db.UserTodoViewPreferences.Add(new UserTodoViewPreference { ViewerId = Friend, TodoItemId = task.Id, CompletedByViewer = true });
            await db.SaveChangesAsync();
            taskId = task.Id;
        }

        await using (var scope = provider.CreateAsyncScope())
        {
            var repository = scope.ServiceProvider.GetRequiredService<ITodoRepository>();
            Assert.Equal(3, await repository.RemoveUserFromOthersTodosAsync(Friend));
            await scope.ServiceProvider.GetRequiredService<TodoDbContext>().SaveChangesAsync();
        }

        await using (var scope = provider.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<TodoDbContext>();
            Assert.Empty(await db.TodoItemShares.ToListAsync());
            Assert.Empty(await db.UserTodoViewPreferences.ToListAsync());
            Assert.Equal(0, await CountAsync(db, "todo.todo_item_workers"));
            // The owner's task itself is untouched.
            Assert.True(await db.TodoItems.AnyAsync(t => t.Id == taskId && !t.IsDeleted));
        }
    }

    private static async Task<long> CountAsync(DbContext db, string table)
    {
        var connection = db.Database.GetDbConnection();
        await db.Database.OpenConnectionAsync();
        try
        {
            await using var command = connection.CreateCommand();
            command.CommandText = $"SELECT count(*) FROM {table}";
            return (long)(await command.ExecuteScalarAsync())!;
        }
        finally
        {
            await db.Database.CloseConnectionAsync();
        }
    }
}
