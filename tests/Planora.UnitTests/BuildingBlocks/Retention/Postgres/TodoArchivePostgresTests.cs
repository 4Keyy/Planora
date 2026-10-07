using Microsoft.EntityFrameworkCore;
using Planora.Todo.Domain.Entities;
using Planora.Todo.Infrastructure.Persistence;
using Planora.Todo.Infrastructure.Persistence.Repositories;
using static Planora.UnitTests.BuildingBlocks.Retention.Postgres.RetentionTestKit;

namespace Planora.UnitTests.BuildingBlocks.Retention.Postgres;

/// <summary>
/// The completed archive's order and date window for a friend's task the viewer completed only for
/// themselves, on PostgreSQL: the ordering is a correlated subquery inside a COALESCE, which EF InMemory
/// would evaluate in memory rather than translate.
/// </summary>
[Trait("TestType", "Integration")]
public sealed class TodoArchivePostgresTests
{
    private static readonly Guid Viewer = Guid.NewGuid();
    private static readonly Guid Friend = Guid.NewGuid();

    [PostgresFact]
    public async Task Archive_OrdersAViewerOnlyCompletionByTheViewersOwnTime_AndMatchesItsDateWindow()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        var now = DateTime.UtcNow;

        Guid ownId, recentId, olderId, untouchedId;
        await using (var db = new TodoDbContext(database.Options<TodoDbContext>()))
        {
            await db.Database.EnsureCreatedAsync();

            var own = TodoItem.Create(Viewer, "my task, done ten days ago");
            own.MarkAsDone(Viewer);
            Set(own, nameof(TodoItem.CompletedAt), now.AddDays(-10));

            // Created long ago and never closed by their owner; only the viewer completed them.
            var recent = TodoItem.Create(Friend, "friend's task I finished two days ago", sharedWithUserIds: new[] { Viewer });
            var older = TodoItem.Create(Friend, "friend's task I finished twenty days ago", sharedWithUserIds: new[] { Viewer });
            var untouched = TodoItem.Create(Friend, "friend's task I never completed", sharedWithUserIds: new[] { Viewer });
            foreach (var task in new[] { recent, older, untouched })
                Set(task, nameof(TodoItem.CreatedAt), now.AddDays(-60));

            db.AddRange(own, recent, older, untouched);
            await db.SaveChangesAsync();

            db.UserTodoViewPreferences.AddRange(
                new UserTodoViewPreference { ViewerId = Viewer, TodoItemId = recent.Id, CompletedByViewer = true, CompletedByViewerAt = now.AddDays(-2) },
                new UserTodoViewPreference { ViewerId = Viewer, TodoItemId = older.Id, CompletedByViewer = true, CompletedByViewerAt = now.AddDays(-20) },
                // Another viewer's completion of the untouched task must not order it for this one.
                new UserTodoViewPreference { ViewerId = Guid.NewGuid(), TodoItemId = untouched.Id, CompletedByViewer = true, CompletedByViewerAt = now });
            await db.SaveChangesAsync();
            (ownId, recentId, olderId, untouchedId) = (own.Id, recent.Id, older.Id, untouched.Id);
        }

        await using (var db = new TodoDbContext(database.Options<TodoDbContext>()))
        {
            var repository = new TodoRepository(db);
            var ids = new[] { ownId, recentId, olderId };

            var page = await repository.GetPagedWithIncludesAsync(
                t => ids.Contains(t.Id), pageNumber: 1, pageSize: 10,
                sortCompletedByCompletionTime: true, completionViewerId: Viewer);
            Assert.Equal(new[] { recentId, ownId, olderId }, page.Items.Select(t => t.Id));

            // Without a viewer the friend's tasks have no completion time and fall back to their owner's
            // last update — moments ago, when they were shared — which put a task finished twenty days
            // ago above one finished ten days ago. That is the order the archive used to show.
            var anonymous = await repository.GetPagedWithIncludesAsync(
                t => ids.Contains(t.Id), pageNumber: 1, pageSize: 10,
                sortCompletedByCompletionTime: true, completionViewerId: null);
            Assert.Equal(ownId, anonymous.Items[^1].Id);

            var preferences = new UserTodoViewPreferenceRepository(db);
            Assert.Equal(new[] { recentId },
                await preferences.GetCompletedTodoIdsByViewerInWindowAsync(Viewer, now.AddDays(-5), now));
            Assert.Equal(new[] { olderId },
                await preferences.GetCompletedTodoIdsByViewerInWindowAsync(Viewer, null, now.AddDays(-5)));
            Assert.Empty(await preferences.GetCompletedTodoIdsByViewerInWindowAsync(Viewer, now.AddDays(-1), null));
            Assert.DoesNotContain(untouchedId,
                await preferences.GetCompletedTodoIdsByViewerInWindowAsync(Viewer, null, null));
        }
    }
}
