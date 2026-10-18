using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Planora.BuildingBlocks.Application.Context;
using Planora.Todo.Application.Features.Todos.Queries.GetCategoryTaskCounts;
using Planora.Todo.Application.Services;
using Planora.Todo.Domain.Entities;
using Planora.Todo.Infrastructure.Persistence;
using Planora.Todo.Infrastructure.Persistence.Repositories;

namespace Planora.UnitTests.BuildingBlocks.Retention.Postgres;

/// <summary>
/// The category cards' open-task counts on PostgreSQL: the composed access predicate (a share EXISTS
/// plus two id lists) and the narrow projection must translate to SQL, which the in-memory mocks of
/// the handler suite never prove.
/// </summary>
[Trait("TestType", "Integration")]
public sealed class TodoCategoryCountsPostgresTests
{
    private static readonly Guid Viewer = Guid.NewGuid();
    private static readonly Guid Friend = Guid.NewGuid();

    [PostgresFact]
    public async Task Counts_OwnTasksByTheirCategory_AndSharedTasksByTheViewersOwn()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        var work = Guid.NewGuid();
        var home = Guid.NewGuid();

        await using (var db = new TodoDbContext(database.Options<TodoDbContext>()))
        {
            await db.Database.EnsureCreatedAsync();

            var parent = TodoItem.Create(Viewer, "open, work", categoryId: work);
            var done = TodoItem.Create(Viewer, "done, work", categoryId: work);
            done.MarkAsDone(Viewer);
            var deleted = TodoItem.Create(Viewer, "deleted, home", categoryId: home);
            deleted.MarkAsDeleted(Viewer);
            var filed = TodoItem.Create(Friend, "shared, filed under home", categoryId: Guid.NewGuid(), sharedWithUserIds: [Viewer]);
            var finished = TodoItem.Create(Friend, "shared, finished by the viewer", sharedWithUserIds: [Viewer]);
            var unshared = TodoItem.Create(Friend, "friend's private task", categoryId: Guid.NewGuid());
            db.AddRange(parent, done, deleted, filed, finished, unshared);
            db.Add(TodoItem.CreateSubtask(parent, Viewer, "a step", null));
            await db.SaveChangesAsync();

            db.UserTodoViewPreferences.AddRange(
                new UserTodoViewPreference { ViewerId = Viewer, TodoItemId = filed.Id, ViewerCategoryId = home },
                new UserTodoViewPreference { ViewerId = Viewer, TodoItemId = finished.Id, ViewerCategoryId = home, CompletedByViewer = true, CompletedByViewerAt = DateTime.UtcNow },
                // Filing a task the viewer cannot see grants nothing.
                new UserTodoViewPreference { ViewerId = Viewer, TodoItemId = unshared.Id, ViewerCategoryId = home });
            await db.SaveChangesAsync();
        }

        await using var context = new TodoDbContext(database.Options<TodoDbContext>());
        var currentUser = new Mock<ICurrentUserContext>();
        currentUser.SetupGet(c => c.UserId).Returns(Viewer);
        var friendship = new Mock<IFriendshipService>();
        friendship.Setup(f => f.GetFriendshipsAsync(Viewer, It.IsAny<CancellationToken>()))
            .ReturnsAsync([new FriendshipInfo(Friend, null)]);
        var handler = new GetCategoryTaskCountsQueryHandler(
            new TodoRepository(context),
            new UserTodoViewPreferenceRepository(context),
            friendship.Object,
            currentUser.Object,
            NullLogger<GetCategoryTaskCountsQueryHandler>.Instance);

        var counts = (await handler.Handle(new GetCategoryTaskCountsQuery(), CancellationToken.None))
            .ToDictionary(c => c.CategoryId, c => c.OpenCount);

        Assert.Equal(2, counts.Count);
        Assert.Equal(1, counts[work]);
        Assert.Equal(1, counts[home]);
    }
}
