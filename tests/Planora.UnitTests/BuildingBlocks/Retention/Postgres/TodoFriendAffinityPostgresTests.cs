using System.Data.Common;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Planora.BuildingBlocks.Application.Context;
using Planora.Todo.Application.DTOs;
using Planora.Todo.Application.Features.Todos.Queries.GetFriendAffinity;
using Planora.Todo.Application.Services;
using Planora.Todo.Domain.Entities;
using Planora.Todo.Infrastructure.Persistence;
using Planora.Todo.Infrastructure.Persistence.Repositories;

namespace Planora.UnitTests.BuildingBlocks.Retention.Postgres;

[Trait("TestType", "Integration")]
public sealed class TodoFriendAffinityPostgresTests
{
    [PostgresFact]
    public async Task ProjectsEligibleDirectedSharesInOneUntrackedSqlQuery()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        var now = new DateTime(2026, 10, 18, 12, 0, 0, DateTimeKind.Utc);
        var viewer = Guid.NewGuid();
        var friend = Guid.NewGuid();
        var otherFriend = Guid.NewGuid();
        var former = Guid.NewGuid();

        await using (var db = new TodoDbContext(database.Options<TodoDbContext>()))
        {
            await db.Database.EnsureCreatedAsync();
            var outgoing = TodoItem.Create(viewer, "shared with two friends and a former friend",
                sharedWithUserIds: [friend, otherFriend, former]);
            outgoing.MarkAsDone(viewer);
            outgoing.SetHidden(true, viewer);
            var incoming = TodoItem.Create(friend, "old incoming with another recipient",
                sharedWithUserIds: [viewer, otherFriend]);
            db.AddRange(outgoing, incoming,
                TodoItem.Create(former, "former friend", sharedWithUserIds: [viewer]),
                TodoItem.Create(Guid.NewGuid(), "stranger", sharedWithUserIds: [viewer]),
                TodoItem.Create(otherFriend, "not shared with caller", sharedWithUserIds: [friend]),
                TodoItem.Create(viewer, "private"));

            foreach (var owner in new[] { viewer, friend })
            {
                var recipient = owner == viewer ? friend : viewer;
                var deleted = TodoItem.Create(owner, "deleted", sharedWithUserIds: [recipient]);
                deleted.MarkAsDeleted(owner);
                db.AddRange(deleted,
                    TodoItem.Create(owner, "legacy All friends", isPublic: true, sharedWithUserIds: [recipient]),
                    TodoItem.Create(owner, "snapshot All friends", isPublic: true,
                        sharedWithUserIds: [recipient], allFriendsSnapshotAt: now));
            }
            db.Add(TodoItem.CreateSubtask(outgoing, viewer, "outgoing child", null));
            db.Add(TodoItem.CreateSubtask(incoming, friend, "incoming child", null));
            db.UserTodoViewPreferences.Add(new UserTodoViewPreference
            {
                ViewerId = viewer, TodoItemId = incoming.Id, HiddenByViewer = true,
                CompletedByViewer = true, CompletedByViewerAt = now,
            });
            // Creating a child touches its parent, so fix timestamps after all domain mutations.
            RetentionTestKit.Set(outgoing, nameof(TodoItem.CreatedAt), now.AddDays(-90));
            RetentionTestKit.Set(outgoing, nameof(TodoItem.UpdatedAt), now);
            RetentionTestKit.Set(incoming, nameof(TodoItem.CreatedAt), now.AddDays(-30));
            RetentionTestKit.Set(incoming, nameof(TodoItem.UpdatedAt), null);
            await db.SaveChangesAsync();
        }

        var commands = new QueryRecorder();
        var options = new DbContextOptionsBuilder<TodoDbContext>(database.Options<TodoDbContext>())
            .AddInterceptors(commands).Options;
        await using var context = new TodoDbContext(options);
        var currentUser = new Mock<ICurrentUserContext>();
        currentUser.SetupGet(c => c.UserId).Returns(viewer);
        var friendship = new Mock<IFriendshipService>();
        friendship.Setup(f => f.GetFriendshipsAsync(viewer, It.IsAny<CancellationToken>()))
            .ReturnsAsync([new FriendshipInfo(friend, null), new FriendshipInfo(otherFriend, null)]);
        var clock = new Mock<TimeProvider>();
        clock.Setup(c => c.GetUtcNow()).Returns(new DateTimeOffset(now));
        var handler = new GetFriendAffinityQueryHandler(new TodoRepository(context), friendship.Object,
            currentUser.Object, clock.Object, NullLogger<GetFriendAffinityQueryHandler>.Instance);

        var results = await handler.Handle(new GetFriendAffinityQuery(), CancellationToken.None);

        Assert.Equal(new FriendAffinityDto { FriendId = friend, Score = 1.5, SharedByMe = 1, SharedWithMe = 1 }, results[0]);
        Assert.Equal(new FriendAffinityDto { FriendId = otherFriend, Score = 1, SharedByMe = 1, SharedWithMe = 0 }, results[1]);
        Assert.Equal(2, results.Count);
        Assert.Empty(context.ChangeTracker.Entries());
        var sql = Assert.Single(commands.Reads);
        Assert.Contains("COALESCE", sql, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("todo_item_shares", sql, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("title", sql, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("description", sql, StringComparison.OrdinalIgnoreCase);
    }

    private sealed class QueryRecorder : DbCommandInterceptor
    {
        public List<string> Reads { get; } = [];

        public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(
            DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result,
            CancellationToken cancellationToken = default)
        {
            Reads.Add(command.CommandText);
            return base.ReaderExecutingAsync(command, eventData, result, cancellationToken);
        }
    }
}
