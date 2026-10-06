using System.Reflection;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Planora.BuildingBlocks.Application.Outbox;
using Planora.BuildingBlocks.Infrastructure.Retention;
using Planora.Todo.Domain.Entities;
using Planora.Todo.Domain.Repositories;
using Planora.Todo.Infrastructure.Retention;

namespace Planora.UnitTests.BuildingBlocks.Retention;

/// <summary>
/// Eligibility coverage for the completed-task auto-delete (<see cref="CompletedTodoPolicy"/>) and the
/// per-holder hide (<see cref="TodoCompletedViewerHidePolicy"/>). Dry-run against EF InMemory asserts on
/// the set each policy would act on — the actual soft-delete cascade goes through the domain path and is
/// validated end-to-end at runtime.
/// </summary>
public sealed class CompletedTodoRetentionPolicyTests
{
    private static readonly DateTime Now = new(2026, 07, 07, 03, 00, 00, DateTimeKind.Utc);
    private static readonly Guid Owner = Guid.NewGuid();

    private sealed class TodoRetentionTestDbContext : DbContext
    {
        public TodoRetentionTestDbContext(DbContextOptions options) : base(options) { }

        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            modelBuilder.Entity<TodoItem>(b =>
            {
                b.Ignore("DomainEvents");
                b.Ignore(t => t.Tags);
                b.Ignore(t => t.SharedWith);
                b.Ignore(t => t.Workers);
            });
            modelBuilder.Entity<UserTodoViewPreference>().HasKey(p => new { p.ViewerId, p.TodoItemId });
        }
    }

    private sealed class AlwaysGrantLock : IRetentionLock
    {
        public Task<bool> TryAcquireAsync(DbContext db, long key, CancellationToken ct) => Task.FromResult(true);
        public Task ReleaseAsync(DbContext db, long key) => Task.CompletedTask;
    }

    private static void BackdateCompletedAt(TodoItem item, DateTime value) =>
        typeof(TodoItem).GetProperty(nameof(TodoItem.CompletedAt), BindingFlags.Public | BindingFlags.Instance)!
            .GetSetMethod(nonPublic: true)!.Invoke(item, new object?[] { value });

    private static TodoItem CompletedRoot(DateTime completedAt)
    {
        var t = TodoItem.Create(Owner, "done");
        t.MarkAsDone(Owner);
        BackdateCompletedAt(t, completedAt);
        return t;
    }

    private static TodoRetentionTestDbContext NewDb() =>
        new(new DbContextOptionsBuilder<TodoRetentionTestDbContext>()
            .UseInMemoryDatabase($"todo-ret-{Guid.NewGuid():N}").Options);

    private static async Task<RetentionResult> RunAsync(IRetentionPolicy policy, DbContext db, RetentionOptions options)
    {
        var services = new ServiceCollection();
        services.AddSingleton<DbContext>(db);
        // Resolved by the policy up front but never invoked on the dry-run count path.
        services.AddScoped(_ => Mock.Of<ITodoRepository>());
        services.AddScoped(_ => Mock.Of<IOutboxRepository>());
        await using var provider = services.BuildServiceProvider();
        return await policy.ExecuteAsync(provider, new RetentionContext(options, Now), CancellationToken.None);
    }

    [Fact]
    [Trait("TestType", "Unit")]
    public async Task CompletedPolicy_SelectsOnlyOldCompletedRoots()
    {
        await using var db = NewDb();

        db.Add(CompletedRoot(Now.AddDays(-40)));                 // eligible
        db.Add(CompletedRoot(Now.AddDays(-10)));                 // recent → kept
        db.Add(TodoItem.Create(Owner, "still open"));            // not done → kept

        var deletedRoot = CompletedRoot(Now.AddDays(-40));
        deletedRoot.MarkAsDeleted(Owner);
        db.Add(deletedRoot);                                     // already deleted → kept

        var parent = CompletedRoot(Now.AddDays(-40));
        db.Add(parent);                                          // eligible root (counts once)
        var subtask = TodoItem.CreateSubtask(parent, Owner, "sub", null);
        subtask.MarkAsDone(Owner);
        BackdateCompletedAt(subtask, Now.AddDays(-40));
        db.Add(subtask);                                         // subtask → excluded (goes with parent)

        await db.SaveChangesAsync();

        var policy = new CompletedTodoPolicy(new AlwaysGrantLock(), NullLogger<CompletedTodoPolicy>.Instance);
        var result = await RunAsync(policy, db, new RetentionOptions
        {
            DryRun = true, PurgeCompletedTasks = true, CompletedTaskDays = 30, MaxDeletionsPerRun = 1000
        });

        Assert.True(result.DryRun);
        Assert.Equal(0, result.Deleted);
        Assert.Equal(2, result.Scanned); // the two eligible roots; subtask + recent + open + deleted excluded
    }

    [Fact]
    [Trait("TestType", "Unit")]
    public async Task ViewerHidePolicy_SelectsOldPersonalCompletionsOnStillActiveTasks()
    {
        await using var db = NewDb();

        var activeTask = TodoItem.Create(Owner, "shared, owner still active"); // Status = Todo
        var doneTask = CompletedRoot(Now.AddDays(-40));                         // globally completed
        db.Add(activeTask);
        db.Add(doneTask);
        await db.SaveChangesAsync();

        var viewer = Guid.NewGuid();
        db.Add(new UserTodoViewPreference { ViewerId = viewer, TodoItemId = activeTask.Id, CompletedByViewer = true, CompletedByViewerAt = Now.AddDays(-40), HiddenByViewer = false }); // eligible
        db.Add(new UserTodoViewPreference { ViewerId = Guid.NewGuid(), TodoItemId = activeTask.Id, CompletedByViewer = true, CompletedByViewerAt = Now.AddDays(-5), HiddenByViewer = false }); // recent → kept
        db.Add(new UserTodoViewPreference { ViewerId = Guid.NewGuid(), TodoItemId = activeTask.Id, CompletedByViewer = true, CompletedByViewerAt = Now.AddDays(-40), HiddenByViewer = true }); // already hidden → kept
        db.Add(new UserTodoViewPreference { ViewerId = Guid.NewGuid(), TodoItemId = doneTask.Id, CompletedByViewer = true, CompletedByViewerAt = Now.AddDays(-40), HiddenByViewer = false }); // task globally done → handled by delete, kept here
        await db.SaveChangesAsync();

        var policy = new TodoCompletedViewerHidePolicy(new AlwaysGrantLock(), NullLogger<TodoCompletedViewerHidePolicy>.Instance);
        var result = await RunAsync(policy, db, new RetentionOptions
        {
            DryRun = true, PurgeCompletedTasks = true, CompletedTaskDays = 30, MaxDeletionsPerRun = 1000
        });

        Assert.Equal(1, result.Scanned);
    }
}
