using Microsoft.EntityFrameworkCore;
using Planora.Todo.Application.Common;
using Planora.Todo.Domain.Entities;
using Planora.Todo.Infrastructure.Persistence;
using Planora.UnitTests.BuildingBlocks.Retention.Postgres;

namespace Planora.UnitTests.Services.TodoApi.Infrastructure;

public sealed class AllFriendsSnapshotPostgresTests
{
    [Fact]
    public void VisibilityPredicate_TranslatesTheSnapshotFallbackAndShareMembershipToPostgresSql()
    {
        var viewer = Guid.NewGuid(); var owner = Guid.NewGuid();
        var options = new DbContextOptionsBuilder<TodoDbContext>()
            .UseNpgsql("Host=127.0.0.1;Database=planora_snapshot_sql;Username=fixture").Options;
        using var db = new TodoDbContext(options);
        var predicate = TodoAccessPolicy.And(todo => !todo.IsDeleted && todo.ParentTodoId == null,
            TodoAccessPolicy.VisibleTo(viewer, [owner]));
        var sql = db.TodoItems.Where(predicate).ToQueryString();
        Assert.Contains("\"AllFriendsSnapshotAt\"", sql, StringComparison.Ordinal);
        Assert.Contains("IS NULL", sql, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("todo_item_shares", sql, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("EXISTS", sql, StringComparison.OrdinalIgnoreCase);
    }

    [PostgresFact]
    public Task ConcurrentParentFreeze_RejectsALegacyChildAndItsOutboxUntilAFreshRetry() =>
        VerifyConcurrentParentFreezeAsync(clockMovedBackwards: false);

    [PostgresFact]
    public Task BackwardClock_StillUpdatesParentAndRejectsConcurrentFreeze() =>
        VerifyConcurrentParentFreezeAsync(clockMovedBackwards: true);

    private static async Task VerifyConcurrentParentFreezeAsync(bool clockMovedBackwards)
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        var owner = Guid.NewGuid(); var early = Guid.NewGuid(); var late = Guid.NewGuid(); Guid parentId;
        await using (var seed = new TodoDbContext(database.Options<TodoDbContext>()))
        {
            await seed.Database.EnsureCreatedAsync();
            var parent = TodoItem.Create(owner, "legacy parent", isPublic: true, sharedWithUserIds: [early]);
            seed.Add(parent); await seed.SaveChangesAsync(); parentId = parent.Id;
            if (clockMovedBackwards)
                await seed.TodoItems.Where(todo => todo.Id == parentId).ExecuteUpdateAsync(
                    setters => setters.SetProperty(todo => todo.UpdatedAt, DateTime.UtcNow.AddMinutes(1)));
        }
        Guid childId, outboxId;
        await using (var creation = new TodoDbContext(database.Options<TodoDbContext>()))
        {
            var parent = await creation.TodoItems.Include(t => t.SharedWith).Include(t => t.Workers).SingleAsync(t => t.Id == parentId);
            var previousUpdatedAt = parent.UpdatedAt;
            var child = TodoItem.CreateSubtask(parent, owner, "prepared from legacy", null);
            creation.ChangeTracker.DetectChanges();
            Assert.Equal(EntityState.Modified, creation.Entry(parent).State);
            if (clockMovedBackwards)
                Assert.Equal(previousUpdatedAt!.Value.AddTicks(10), parent.UpdatedAt);
            Assert.Null(child.AllFriendsSnapshotAt);
            var message = new Planora.BuildingBlocks.Application.Outbox.OutboxMessage("fixture", "{}", DateTime.UtcNow);
            creation.Add(child); creation.OutboxMessages.Add(message); childId = child.Id; outboxId = message.Id;
            await using (var freezing = new TodoDbContext(database.Options<TodoDbContext>()))
            {
                var concurrentParent = await freezing.TodoItems.Include(t => t.SharedWith).Include(t => t.Workers).SingleAsync(t => t.Id == parentId);
                concurrentParent.FreezeAllFriendsAudience([early], concurrentParent.CreatedAt);
                await freezing.SaveChangesAsync();
            }
            await Assert.ThrowsAsync<DbUpdateConcurrencyException>(() => creation.SaveChangesAsync());
        }
        await using (var verify = new TodoDbContext(database.Options<TodoDbContext>()))
        {
            Assert.False(await verify.TodoItems.AnyAsync(t => t.Id == childId));
            Assert.False(await verify.OutboxMessages.AnyAsync(m => m.Id == outboxId));
            var parent = await verify.TodoItems.Include(t => t.SharedWith).Include(t => t.Workers).SingleAsync(t => t.Id == parentId);
            Assert.NotNull(parent.AllFriendsSnapshotAt);
            var retriedChild = TodoItem.CreateSubtask(parent, owner, "fresh retry", null);
            verify.Add(retriedChild); await verify.SaveChangesAsync();
            Assert.Equal(parent.AllFriendsSnapshotAt, retriedChild.AllFriendsSnapshotAt);
            Assert.Equal(new[] { early }, retriedChild.SharedWith.Select(share => share.SharedWithUserId));
            Assert.False(await verify.TodoItems.Where(TodoAccessPolicy.VisibleTo(late, [owner])).AnyAsync(t => t.Id == retriedChild.Id));
        }
    }

    [PostgresFact]
    public async Task RealPostgres_RestrictsTheFrozenCircleAndKeepsLegacyFallbackUntilFreeze()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        var viewer = Guid.NewGuid(); var owner = Guid.NewGuid(); var other = Guid.NewGuid();
        Guid ownId, frozenId, legacyId;
        await using (var db = new TodoDbContext(database.Options<TodoDbContext>()))
        {
            await db.Database.EnsureCreatedAsync();
            var own = TodoItem.Create(viewer, "own");
            var frozen = TodoItem.Create(owner, "snapshot member", isPublic: true, sharedWithUserIds: [viewer], allFriendsSnapshotAt: DateTime.UtcNow);
            var frozenWithoutViewer = TodoItem.Create(owner, "later friend", isPublic: true, sharedWithUserIds: [other], allFriendsSnapshotAt: DateTime.UtcNow);
            var legacy = TodoItem.Create(owner, "legacy", isPublic: true, sharedWithUserIds: [viewer]);
            var stranger = TodoItem.Create(Guid.NewGuid(), "not friends", sharedWithUserIds: [viewer]);
            var privateFriend = TodoItem.Create(owner, "private");
            db.AddRange(own, frozen, frozenWithoutViewer, legacy, stranger, privateFriend);
            await db.SaveChangesAsync();
            (ownId, frozenId, legacyId) = (own.Id, frozen.Id, legacy.Id);
        }
        await using (var db = new TodoDbContext(database.Options<TodoDbContext>()))
        {
            var ids = await db.TodoItems.AsNoTracking().Where(TodoAccessPolicy.VisibleTo(viewer, [owner])).Select(t => t.Id).ToListAsync();
            Assert.Equal(new HashSet<Guid> { ownId, frozenId, legacyId }, ids.ToHashSet());
            var legacy = await db.TodoItems.Include(t => t.SharedWith).Include(t => t.Workers).SingleAsync(t => t.Id == legacyId);
            // Keeping an existing share during a tracked freeze must also survive EF identity tracking.
            legacy.FreezeAllFriendsAudience([viewer], legacy.CreatedAt);
            await db.SaveChangesAsync();
        }
        await using (var db = new TodoDbContext(database.Options<TodoDbContext>()))
        {
            var task = await db.TodoItems.Include(t => t.SharedWith).SingleAsync(t => t.Id == frozenId);
            task.SetSharedWith([], owner); // friendship-removal consumer's materialised share removal
            await db.SaveChangesAsync();
        }
        await using (var db = new TodoDbContext(database.Options<TodoDbContext>()))
        {
            Assert.DoesNotContain(frozenId, await db.TodoItems.Where(TodoAccessPolicy.VisibleTo(viewer, [owner])).Select(t => t.Id).ToListAsync());
            Assert.Equal(new[] { ownId }, await db.TodoItems.Where(TodoAccessPolicy.VisibleTo(viewer, [])).Select(t => t.Id).ToListAsync());
        }
    }
}
