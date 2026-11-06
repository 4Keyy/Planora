using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Planora.BuildingBlocks.Application.Messaging.Events;
using Planora.BuildingBlocks.Domain.Interfaces;
using Planora.Collaboration.Application.Features.IntegrationEvents;
using Planora.Collaboration.Domain.Entities;
using Planora.Collaboration.Domain.Enums;
using Planora.Collaboration.Infrastructure.Persistence;
using Planora.Collaboration.Infrastructure.Persistence.Repositories;
using Planora.UnitTests.BuildingBlocks.Retention.Postgres;

namespace Planora.UnitTests.Services.CollaborationApi.Infrastructure;

public sealed class SubtaskActivityIdentityPostgresTests
{
    [PostgresFact]
    public async Task DeleteAsync_DuplicateTitlesDeleteOnlyTheSelectedSubtaskActivityAndReplayIsHarmless()
    {
        await using var database = await ReadyDatabaseAsync();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        var parent = Guid.NewGuid(); var first = Guid.NewGuid(); var second = Guid.NewGuid(); var actor = Guid.NewGuid();
        var firstCreated = await ActivityAsync(database, parent, first, TaskActivityType.SubtaskCreated, "Same title", timeout.Token);
        var secondCreated = await ActivityAsync(database, parent, second, TaskActivityType.SubtaskCreated, "Same title", timeout.Token);
        var firstCompleted = await ActivityAsync(database, parent, first, TaskActivityType.SubtaskCompleted, "Same title", timeout.Token);
        var secondCompleted = await ActivityAsync(database, parent, second, TaskActivityType.SubtaskCompleted, "Same title", timeout.Token);

        await DeleteAsync(database, parent, first, actor, "Same title", timeout.Token);

        var rows = await ReadAsync(database, timeout.Token);
        AssertDeleted(rows, firstCreated, actor); AssertDeleted(rows, firstCompleted, actor);
        AssertAlive(rows, secondCreated); AssertAlive(rows, secondCompleted);
        AssertSource(rows, firstCreated, first); AssertSource(rows, firstCompleted, first);
        AssertSource(rows, secondCreated, second); AssertSource(rows, secondCompleted, second);
        var tombstones = rows.Where(row => row.IsDeleted).OrderBy(row => row.Id)
            .Select(row => (row.Id, row.DeletedAt, row.DeletedBy)).ToArray();

        await DeleteAsync(database, parent, first, actor, "Same title", timeout.Token);

        var replay = await ReadAsync(database, timeout.Token);
        Assert.Equal(tombstones, replay.Where(row => row.IsDeleted).OrderBy(row => row.Id)
            .Select(row => (row.Id, row.DeletedAt, row.DeletedBy)).ToArray());
        AssertAlive(replay, secondCreated); AssertAlive(replay, secondCompleted);
    }

    [PostgresFact]
    public async Task DeleteAsync_RenameUsesIdentityAndPreservesTheSubtaskWithTheNewTitle()
    {
        await using var database = await ReadyDatabaseAsync();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        var parent = Guid.NewGuid(); var first = Guid.NewGuid(); var second = Guid.NewGuid(); var actor = Guid.NewGuid();
        var beforeRename = await ActivityAsync(database, parent, first, TaskActivityType.SubtaskCreated, "Original title", timeout.Token);
        var afterRename = await ActivityAsync(database, parent, first, TaskActivityType.SubtaskCompleted, "Renamed title", timeout.Token);
        var other = await ActivityAsync(database, parent, second, TaskActivityType.SubtaskCreated, "Renamed title", timeout.Token);

        await DeleteAsync(database, parent, first, actor, "Renamed title", timeout.Token);

        var rows = await ReadAsync(database, timeout.Token);
        AssertDeleted(rows, beforeRename, actor); AssertDeleted(rows, afterRename, actor); AssertAlive(rows, other);
    }

    [PostgresFact]
    public async Task DeleteAsync_UnicodeAndSentenceSuffixCollisionCannotDeleteAnotherIdentity()
    {
        await using var database = await ReadyDatabaseAsync();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        var parent = Guid.NewGuid(); var first = Guid.NewGuid(); var second = Guid.NewGuid(); var actor = Guid.NewGuid();
        const string title = "План 🧩 %_[]";
        var target = await ActivityAsync(database, parent, first, TaskActivityType.SubtaskCompleted, title, timeout.Token);
        var collision = await ActivityAsync(database, parent, second, TaskActivityType.SubtaskCreated,
            $"completed a subtask: {title}", timeout.Token);

        await DeleteAsync(database, parent, first, actor, title, timeout.Token);

        var rows = await ReadAsync(database, timeout.Token);
        AssertDeleted(rows, target, actor); AssertAlive(rows, collision);
    }

    [PostgresFact]
    public async Task DeleteAsync_PreservesLegacyUnknownIdentityRegularCommentsAndRootActivity()
    {
        await using var database = await ReadyDatabaseAsync();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        var parent = Guid.NewGuid(); var subtask = Guid.NewGuid(); var actor = Guid.NewGuid();
        const string title = "Do not guess an identity";
        var target = await ActivityAsync(database, parent, subtask, TaskActivityType.SubtaskCreated, title, timeout.Token);
        var legacy = await ActivityAsync(database, parent, null, TaskActivityType.SubtaskCreated, title, timeout.Token);
        // A source id on a root activity is unrelated context and must not turn that row into subtask activity.
        var rootCompleted = await ActivityAsync(database, parent, subtask, TaskActivityType.Completed, title, timeout.Token);
        var rootStarted = await ActivityAsync(database, parent, subtask, TaskActivityType.StartedWorking, title, timeout.Token);
        var rootLeft = await ActivityAsync(database, parent, subtask, TaskActivityType.Left, title, timeout.Token);
        var regular = Comment.Create(parent, actor, "Synthetic User", $"Synthetic Actor added a subtask: {title}");
        var uncorrelatedSystem = Comment.CreateSystem(parent, $"Synthetic Actor completed a subtask: {title}");
        await InsertAsync(database, timeout.Token, regular, uncorrelatedSystem);

        await DeleteAsync(database, parent, subtask, actor, title, timeout.Token);

        var rows = await ReadAsync(database, timeout.Token);
        AssertDeleted(rows, target, actor);
        foreach (var id in new[] { legacy, rootCompleted, rootStarted, rootLeft, regular.Id, uncorrelatedSystem.Id })
        {
            AssertAlive(rows, id);
            AssertSource(rows, id, null);
        }
        Assert.False(Assert.Single(rows, row => row.Id == regular.Id).IsSystemComment);
        Assert.Equal($"Synthetic Actor added a subtask: {title}", Assert.Single(rows, row => row.Id == legacy).Content);
    }

    [PostgresFact]
    public async Task DeleteAsync_ParentGuardAndReplyTargetScopePreserveOtherBranchesAndQuoteSnapshots()
    {
        await using var database = await ReadyDatabaseAsync();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        var parent = Guid.NewGuid(); var otherParent = Guid.NewGuid(); var subtask = Guid.NewGuid(); var otherSubtask = Guid.NewGuid();
        var actor = Guid.NewGuid();
        var target = await ActivityAsync(database, parent, subtask, TaskActivityType.SubtaskCompleted, "Scoped title", timeout.Token);
        var otherBranch = await ActivityAsync(database, otherParent, subtask, TaskActivityType.SubtaskCompleted, "Scoped title", timeout.Token);
        var otherActivity = await ActivityAsync(database, parent, otherSubtask, TaskActivityType.SubtaskCompleted, "Scoped title", timeout.Token);
        var reply = Reply(parent, actor, subtask, ReplyTargetType.Subtask);
        var otherTargetReply = Reply(parent, actor, otherSubtask, ReplyTargetType.Subtask);
        var otherBranchReply = Reply(otherParent, actor, subtask, ReplyTargetType.Subtask);
        var commentTargetReply = Reply(parent, actor, subtask, ReplyTargetType.Comment);
        await InsertAsync(database, timeout.Token, reply, otherTargetReply, otherBranchReply, commentTargetReply);
        var before = await ReadAsync(database, timeout.Token);

        await DeleteAsync(database, parent, subtask, actor, "Scoped title", timeout.Token);

        var rows = await ReadAsync(database, timeout.Token);
        AssertDeleted(rows, target, actor); AssertAlive(rows, otherBranch); AssertAlive(rows, otherActivity);
        foreach (var id in new[] { reply.Id, otherTargetReply.Id, otherBranchReply.Id, commentTargetReply.Id })
        {
            var stored = Assert.Single(rows, row => row.Id == id);
            var original = Assert.Single(before, row => row.Id == id);
            AssertAlive(rows, id);
            Assert.Equal(id == reply.Id, stored.ReplyToDeleted);
            Assert.Equal((original.Content, original.AuthorId, original.AuthorName, original.CreatedAt, original.UpdatedAt, original.UpdatedBy),
                (stored.Content, stored.AuthorId, stored.AuthorName, stored.CreatedAt, stored.UpdatedAt, stored.UpdatedBy));
            Assert.Equal((original.ReplyToType, original.ReplyToId, original.ReplyToAuthorId, original.ReplyToAuthorName, original.ReplyToPreview),
                (stored.ReplyToType, stored.ReplyToId, stored.ReplyToAuthorId, stored.ReplyToAuthorName, stored.ReplyToPreview));
            Assert.False(stored.IsEdited);
        }
    }

    [PostgresFact]
    public async Task DeleteAsync_DatabaseRejectionAndCancellationRollBackActivityAndReplyFlagsTogether()
    {
        foreach (var cancelBeforeSave in new[] { false, true })
        {
            await using var database = await ReadyDatabaseAsync();
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
            using var requestCancellation = new CancellationTokenSource();
            var parent = Guid.NewGuid(); var subtask = Guid.NewGuid(); var actor = Guid.NewGuid();
            var created = await ActivityAsync(database, parent, subtask, TaskActivityType.SubtaskCreated, "Atomic title", timeout.Token);
            var completed = await ActivityAsync(database, parent, subtask, TaskActivityType.SubtaskCompleted, "Atomic title", timeout.Token);
            var reply = Reply(parent, actor, subtask, ReplyTargetType.Subtask);
            await InsertAsync(database, timeout.Token, reply);
            var before = JsonSerializer.Serialize(await ReadAsync(database, timeout.Token));
            await using var context = new CollaborationDbContext(database.Options<CollaborationDbContext>());
            if (!cancelBeforeSave)
                await context.Database.ExecuteSqlRawAsync("""
                    ALTER TABLE collaboration.comments ADD CONSTRAINT reject_activity_delete CHECK (NOT "IsDeleted")
                    """, timeout.Token);
            var unitOfWork = new ControlledUnitOfWork(new CollaborationUnitOfWork(context),
                cancelBeforeSave ? requestCancellation.Cancel : null);
            var consumer = new SubtaskDeletedEventConsumer(new CommentRepository(context), unitOfWork,
                NullLogger<SubtaskDeletedEventConsumer>.Instance);
            Task Invoke() => consumer.HandleAsync(new SubtaskDeletedIntegrationEvent(parent, subtask, actor, "Atomic title"),
                cancelBeforeSave ? requestCancellation.Token : timeout.Token);

            if (cancelBeforeSave)
            {
                var error = await Assert.ThrowsAnyAsync<OperationCanceledException>(Invoke);
                Assert.Equal(requestCancellation.Token, error.CancellationToken);
            }
            else
                await Assert.ThrowsAsync<DbUpdateException>(Invoke);

            Assert.Equal(1, unitOfWork.SaveAttempts);
            // Verify both members were staged before the real save failed, not an unrelated early exception.
            Assert.True(context.ChangeTracker.Entries<Comment>().Single(entry => entry.Entity.Id == created).Entity.IsDeleted);
            Assert.True(context.ChangeTracker.Entries<Comment>().Single(entry => entry.Entity.Id == completed).Entity.IsDeleted);
            Assert.True(context.ChangeTracker.Entries<Comment>().Single(entry => entry.Entity.Id == reply.Id).Entity.ReplyToDeleted);
            Assert.Equal(before, JsonSerializer.Serialize(await ReadAsync(database, timeout.Token)));
        }
    }

    [PostgresFact]
    public async Task ActivityAsync_BackwardPayloadWithoutIdentityStillProducesTheExistingSentence()
    {
        await using var database = await ReadyDatabaseAsync();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        var parent = Guid.NewGuid();
        var id = await ActivityAsync(database, parent, null, TaskActivityType.SubtaskCompleted, "  Legacy title  ", timeout.Token);

        var rows = await ReadAsync(database, timeout.Token);
        var comment = Assert.Single(rows);
        Assert.Equal(id, comment.Id);
        Assert.Equal(parent, comment.TaskId);
        Assert.Equal("Synthetic Actor completed a subtask: Legacy title", comment.Content);
        Assert.True(comment.IsSystemComment);
        Assert.False(comment.IsGenesisComment);
        Assert.Equal(Guid.Empty, comment.AuthorId);
        Assert.Equal(string.Empty, comment.AuthorName);
        AssertSource(rows, id, null);
        AssertAlive(rows, id);
    }

    [PostgresFact]
    public async Task DeleteBeforeActivity_CharacterizesNoTombstoneAndPreservesOtherSubtaskWithSameTitle()
    {
        await using var database = await ReadyDatabaseAsync();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        var parent = Guid.NewGuid(); var first = Guid.NewGuid(); var second = Guid.NewGuid(); var actor = Guid.NewGuid();
        var alreadyPresent = await ActivityAsync(database, parent, second, TaskActivityType.SubtaskCreated, "Out of order", timeout.Token);

        await DeleteAsync(database, parent, first, actor, "Out of order", timeout.Token);
        var deliveredLater = await ActivityAsync(database, parent, first, TaskActivityType.SubtaskCreated, "Out of order", timeout.Token);

        var rows = await ReadAsync(database, timeout.Token);
        Assert.Equal(2, rows.Count);
        AssertAlive(rows, alreadyPresent);
        // This local identity fix stores no deletion tombstone: late activity remains visible.
        AssertAlive(rows, deliveredLater);
        AssertSource(rows, alreadyPresent, second); AssertSource(rows, deliveredLater, first);
    }

    private static async Task<TemporaryDatabase> ReadyDatabaseAsync()
    {
        var database = await TemporaryDatabase.CreateAsync();
        try
        {
            await using var context = new CollaborationDbContext(database.Options<CollaborationDbContext>());
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
            await CollaborationDatabaseStartup.EnsureReadyAsync(context, NullLogger.Instance, timeout.Token);
            return database;
        }
        catch
        {
            await database.DisposeAsync();
            throw;
        }
    }

    private static async Task<Guid> ActivityAsync(TemporaryDatabase database, Guid parentTaskId, Guid? sourceSubtaskId,
        string activityType, string title, CancellationToken token)
    {
        var payload = new Dictionary<string, object?>
        {
            ["TaskId"] = parentTaskId, ["ActorId"] = Guid.NewGuid(), ["ActorName"] = "Synthetic Actor",
            ["ActivityType"] = activityType, ["Detail"] = title,
        };
        if (sourceSubtaskId.HasValue)
            payload["SourceSubtaskId"] = sourceSubtaskId.Value;
        var activity = JsonSerializer.Deserialize<TaskActivityIntegrationEvent>(JsonSerializer.Serialize(payload))!;
        await using var context = new CollaborationDbContext(database.Options<CollaborationDbContext>());
        var consumer = new TaskActivityEventConsumer(new CommentRepository(context), new CollaborationUnitOfWork(context),
            NullLogger<TaskActivityEventConsumer>.Instance);
        await consumer.HandleAsync(activity, token);
        // A fresh context isolates this insertion even when two activities have identical rendered text.
        return Assert.Single(context.ChangeTracker.Entries<Comment>()).Entity.Id;
    }

    private static async Task DeleteAsync(TemporaryDatabase database, Guid parent, Guid subtask, Guid actor, string title, CancellationToken token)
    {
        await using var context = new CollaborationDbContext(database.Options<CollaborationDbContext>());
        var consumer = new SubtaskDeletedEventConsumer(new CommentRepository(context), new CollaborationUnitOfWork(context),
            NullLogger<SubtaskDeletedEventConsumer>.Instance);
        await consumer.HandleAsync(new SubtaskDeletedIntegrationEvent(parent, subtask, actor, title), token);
    }

    private static async Task InsertAsync(TemporaryDatabase database, CancellationToken token, params Comment[] comments)
    {
        await using var context = new CollaborationDbContext(database.Options<CollaborationDbContext>());
        context.Comments.AddRange(comments);
        await context.SaveChangesAsync(token);
    }

    private static async Task<List<Comment>> ReadAsync(TemporaryDatabase database, CancellationToken token)
    {
        await using var context = new CollaborationDbContext(database.Options<CollaborationDbContext>());
        return await context.Comments.IgnoreQueryFilters().AsNoTracking().OrderBy(comment => comment.Id).ToListAsync(token);
    }

    private static Comment Reply(Guid parent, Guid actor, Guid target, ReplyTargetType type) =>
        Comment.CreateReply(parent, actor, "Synthetic User", "Reply body remains", type, target,
            actor, "Snapshot author", "Snapshot preview remains");

    private static void AssertDeleted(IReadOnlyList<Comment> rows, Guid id, Guid actor)
    {
        var comment = Assert.Single(rows, row => row.Id == id);
        Assert.True(comment.IsDeleted);
        Assert.Equal(actor, comment.DeletedBy);
        Assert.NotNull(comment.DeletedAt);
    }

    private static void AssertAlive(IReadOnlyList<Comment> rows, Guid id)
    {
        var comment = Assert.Single(rows, row => row.Id == id);
        Assert.False(comment.IsDeleted);
        Assert.Null(comment.DeletedAt);
        Assert.Null(comment.DeletedBy);
    }

    private static void AssertSource(IReadOnlyList<Comment> rows, Guid id, Guid? expected)
    {
        var element = JsonSerializer.SerializeToElement(Assert.Single(rows, row => row.Id == id));
        var actual = element.TryGetProperty("SourceSubtaskId", out var source) && source.ValueKind != JsonValueKind.Null
            ? source.GetGuid() : (Guid?)null;
        Assert.Equal(expected, actual);
    }

    private sealed class ControlledUnitOfWork(IUnitOfWork inner, Action? beforeSave = null) : IUnitOfWork
    {
        public int SaveAttempts { get; private set; }
        public bool HasActiveTransaction => inner.HasActiveTransaction;
        public Task<int> SaveChangesAsync(CancellationToken cancellationToken = default)
        {
            SaveAttempts++;
            beforeSave?.Invoke();
            return inner.SaveChangesAsync(cancellationToken);
        }
        public Task BeginTransactionAsync(CancellationToken cancellationToken = default) => inner.BeginTransactionAsync(cancellationToken);
        public Task CommitTransactionAsync(CancellationToken cancellationToken = default) => inner.CommitTransactionAsync(cancellationToken);
        public Task RollbackTransactionAsync(CancellationToken cancellationToken = default) => inner.RollbackTransactionAsync(cancellationToken);
        public void Dispose() => inner.Dispose();
    }
}
