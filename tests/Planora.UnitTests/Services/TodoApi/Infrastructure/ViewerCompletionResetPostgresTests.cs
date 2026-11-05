using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Planora.Todo.Domain.Entities;
using Planora.Todo.Infrastructure.Persistence;
using Planora.Todo.Infrastructure.Persistence.Repositories;
using Planora.UnitTests.BuildingBlocks.Retention.Postgres;

namespace Planora.UnitTests.Services.TodoApi.Infrastructure;

public sealed class ViewerCompletionResetPostgresTests
{
    [PostgresFact]
    public async Task StageResetAsync_DefersWritesAndPreservesConcurrentIndependentPreferenceChanges()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        var ownerId = Guid.NewGuid();
        var firstViewer = Guid.NewGuid();
        var secondViewer = Guid.NewGuid();
        var incompleteViewer = Guid.NewGuid();
        var originalCategory = Guid.NewGuid();
        var changedCategory = Guid.NewGuid();
        var completedAt = new DateTime(2026, 1, 1, 12, 0, 0, DateTimeKind.Utc);
        var target = TodoItem.Create(ownerId, "Reset target");
        var unrelated = TodoItem.Create(ownerId, "Unrelated reset");
        await using (var seed = new TodoDbContext(database.Options<TodoDbContext>()))
        {
            await TodoDatabaseStartup.EnsureReadyAsync(seed, NullLogger.Instance, timeout.Token);
            seed.TodoItems.AddRange(target, unrelated);
            seed.UserTodoViewPreferences.AddRange(
                Preference(firstViewer, target.Id, completed: true),
                Preference(secondViewer, target.Id, completed: true),
                Preference(incompleteViewer, target.Id, completed: false),
                Preference(firstViewer, unrelated.Id, completed: true));
            await seed.SaveChangesAsync(timeout.Token);
        }

        await using var staging = new TodoDbContext(database.Options<TodoDbContext>());
        staging.ChangeTracker.QueryTrackingBehavior = QueryTrackingBehavior.NoTracking;
        var repository = new UserTodoViewPreferenceRepository(staging);
        Assert.Equal(2, await repository.StageClearCompletedByViewerForTodoAsync(target.Id, timeout.Token));
        await using (var beforeSave = new TodoDbContext(database.Options<TodoDbContext>()))
        {
            Assert.Equal(2, await beforeSave.UserTodoViewPreferences.CountAsync(
                row => row.TodoItemId == target.Id && row.CompletedByViewer, timeout.Token));
        }
        await using (var concurrent = new TodoDbContext(database.Options<TodoDbContext>()))
        {
            var preference = await concurrent.UserTodoViewPreferences.SingleAsync(
                row => row.TodoItemId == target.Id && row.ViewerId == firstViewer, timeout.Token);
            preference.HiddenByViewer = true;
            preference.ViewerCategoryId = changedCategory;
            await concurrent.SaveChangesAsync(timeout.Token);
        }

        await staging.SaveChangesAsync(timeout.Token);

        await using var observer = new TodoDbContext(database.Options<TodoDbContext>());
        var stored = await observer.UserTodoViewPreferences.AsNoTracking().ToListAsync(timeout.Token);
        Assert.Equal(4, stored.Count);
        foreach (var preference in stored)
        {
            var unrelatedRow = preference.TodoItemId == unrelated.Id;
            Assert.Equal(unrelatedRow, preference.CompletedByViewer);
            Assert.Equal(unrelatedRow ? completedAt : (DateTime?)null, preference.CompletedByViewerAt);
            var concurrentlyChanged = preference.TodoItemId == target.Id && preference.ViewerId == firstViewer;
            Assert.Equal(concurrentlyChanged, preference.HiddenByViewer);
            Assert.Equal(concurrentlyChanged ? changedCategory : originalCategory, preference.ViewerCategoryId);
        }

        UserTodoViewPreference Preference(Guid viewerId, Guid taskId, bool completed) => new()
        {
            ViewerId = viewerId, TodoItemId = taskId, ViewerCategoryId = originalCategory,
            CompletedByViewer = completed, CompletedByViewerAt = completed ? completedAt : null,
        };
    }
}
