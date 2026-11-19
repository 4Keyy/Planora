using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Planora.BuildingBlocks.Application.Context;
using Planora.BuildingBlocks.Application.Messaging.Events;
using Planora.BuildingBlocks.Domain.Exceptions;
using Planora.Collaboration.Application.Features.Comments.Commands.AddComment;
using Planora.Collaboration.Application.Features.IntegrationEvents;
using Planora.Collaboration.Application.Services;
using Planora.Collaboration.Domain.Entities;
using Planora.Collaboration.Infrastructure.Persistence;
using Planora.Collaboration.Infrastructure.Persistence.Repositories;
using Planora.UnitTests.BuildingBlocks.Retention.Postgres;
using Planora.UnitTests.Services.Infrastructure;

namespace Planora.UnitTests.Services.CollaborationApi.Infrastructure;

[Trait("TestType", "Integration")]
public sealed class BranchDeletionPostgresTests
{
    [VersionedPostgresTheory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task AddComment_AfterCleanupRejectsAStaleAccessSnapshotAndStagesNoEvents(bool replyToSubtask)
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        var token = timeout.Token;
        var taskId = Guid.NewGuid();
        var subtaskId = Guid.NewGuid();
        var authorId = Guid.NewGuid();
        var ownerId = Guid.NewGuid();
        await using var writer = NewContext(database);
        await CollaborationDatabaseStartup.EnsureReadyAsync(writer, NullLogger.Instance, token);

        var currentUser = new Mock<ICurrentUserContext>();
        currentUser.SetupGet(user => user.UserId).Returns(authorId);
        currentUser.SetupGet(user => user.Name).Returns("Synthetic Author");
        var access = new Mock<ITaskAccessService>();
        access.Setup(service => service.CheckCommentAccessAsync(taskId, authorId, token))
            .Returns(async () =>
            {
                var snapshot = new TaskAccessResult(true, true, ownerId,
                    new[] { ownerId, authorId }, string.Empty, null);
                if (!replyToSubtask)
                {
                    await using var cleanup = NewContext(database);
                    await new TaskDeletedEventConsumer(Timeline(cleanup), NullLogger<TaskDeletedEventConsumer>.Instance)
                        .HandleAsync(new TaskDeletedIntegrationEvent(taskId, ownerId), token);
                }
                return snapshot;
            });
        access.Setup(service => service.GetSubtaskBriefAsync(taskId, subtaskId, token))
            .Returns(async () =>
            {
                var snapshot = new SubtaskBrief(true, "Synthetic subtask", ownerId);
                await using var cleanup = NewContext(database);
                await new SubtaskDeletedEventConsumer(Timeline(cleanup), NullLogger<SubtaskDeletedEventConsumer>.Instance)
                    .HandleAsync(new SubtaskDeletedIntegrationEvent(taskId, subtaskId, ownerId, snapshot.Title), token);
                return snapshot;
            });
        var users = new Mock<IUserService>();
        users.Setup(service => service.GetUserProfilesAsync(It.IsAny<IEnumerable<Guid>>(), token))
            .ReturnsAsync(new Dictionary<Guid, UserProfile>());

        var handler = new AddCommentCommandHandler(new CommentRepository(writer), Timeline(writer),
            currentUser.Object, access.Object, new OutboxRepository(writer), users.Object);
        var command = replyToSubtask
            ? new AddCommentCommand(taskId, "Late reply", "subtask", subtaskId)
            : new AddCommentCommand(taskId, "Late comment");
        var failure = await Assert.ThrowsAsync<EntityNotFoundException>(() => handler.Handle(command, token));
        Assert.Contains((replyToSubtask ? subtaskId : taskId).ToString(), failure.Message);

        await using var check = NewContext(database);
        Assert.Empty(await check.Comments.ToListAsync(token));
        Assert.Empty(await check.OutboxMessages.ToListAsync(token));
    }

    [PostgresFact]
    public async Task TaskDeletion_BlocksReplayedCreationAndFirstLateActivity()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        var token = timeout.Token;
        var removed = Guid.NewGuid();
        var live = Guid.NewGuid();
        var actor = Guid.NewGuid();
        var original = new TaskCreatedIntegrationEvent(removed, actor, "Owner", null);

        await using (var db = NewContext(database))
        {
            await CollaborationDatabaseStartup.EnsureReadyAsync(db, NullLogger.Instance, token);
            await new TaskCreatedEventConsumer(Timeline(db), NullLogger<TaskCreatedEventConsumer>.Instance)
                .HandleAsync(original, token);
        }
        await using (var db = NewContext(database))
        {
            var delete = new TaskDeletedEventConsumer(Timeline(db), NullLogger<TaskDeletedEventConsumer>.Instance);
            var deletion = new TaskDeletedIntegrationEvent(removed, actor);
            await delete.HandleAsync(deletion, token);
            await delete.HandleAsync(deletion, token);
        }
        await using (var db = NewContext(database))
        {
            var create = new TaskCreatedEventConsumer(Timeline(db), NullLogger<TaskCreatedEventConsumer>.Instance);
            await create.HandleAsync(original, token);
            await create.HandleAsync(new TaskCreatedIntegrationEvent(live, actor, "Owner", null), token);
        }
        await using (var db = NewContext(database))
        {
            var activity = new TaskActivityEventConsumer(Timeline(db), NullLogger<TaskActivityEventConsumer>.Instance);
            await activity.HandleAsync(new TaskActivityIntegrationEvent(removed, actor, "Owner", TaskActivityType.Completed), token);
            await activity.HandleAsync(new TaskActivityIntegrationEvent(removed, actor, "Owner",
                TaskActivityType.SubtaskCreated, "Legacy payload"), token);
        }

        await using var check = NewContext(database);
        var rows = await check.Comments.AsNoTracking().ToListAsync(token);
        Assert.Equal(2, rows.Count);
        Assert.True(Assert.Single(rows, row => row.TaskId == removed).IsDeleted);
        Assert.False(Assert.Single(rows, row => row.TaskId == live).IsDeleted);
    }

    [PostgresFact]
    public async Task AppendAfterConcurrentCleanupWaitsAndSeesTheCommittedMarker()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(20));
        var token = timeout.Token;
        await using var deletionDb = NewContext(database);
        await CollaborationDatabaseStartup.EnsureReadyAsync(deletionDb, NullLogger.Instance, token);
        await using var writer = NewContext(database);
        await using var observer = NewContext(database);
        var taskId = Guid.NewGuid();
        var pause = new PausedCommentSave(deletionDb);
        var deletion = new BranchTimeline(deletionDb, new CommentRepository(deletionDb), pause)
            .DeleteTaskAsync(taskId, Guid.NewGuid(), token);
        Task<TimelineAppendResult>? append = null;
        try
        {
            await pause.Entered.Task.WaitAsync(token);
            append = Timeline(writer).AppendAsync(Comment.CreateSystem(taskId, "Late activity"), token);
            while (!await observer.Database.SqlQueryRaw<bool>("""
                SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_locks
                    WHERE locktype = 'advisory' AND NOT granted AND database =
                        (SELECT oid FROM pg_catalog.pg_database WHERE datname = current_database())) AS "Value"
                """).SingleAsync(token))
            {
                Assert.False(append.IsCompleted);
                await Task.Delay(25, token);
            }
            pause.Resume.TrySetResult();
            await deletion;
            Assert.Equal(TimelineAppendResult.TaskDeleted, await append);
            Assert.Empty(await observer.Comments.ToListAsync(token));
        }
        finally
        {
            pause.Resume.TrySetResult();
            await deletion;
            if (append is not null)
                await append;
        }
    }

    private static CollaborationDbContext NewContext(TemporaryDatabase database) =>
        new(database.Options<CollaborationDbContext>());

    private static BranchTimeline Timeline(CollaborationDbContext db) =>
        new(db, new CommentRepository(db), new CollaborationUnitOfWork(db));

    private sealed class PausedCommentSave(CollaborationDbContext db)
        : Planora.BuildingBlocks.Domain.Interfaces.IUnitOfWork
    {
        private readonly CollaborationUnitOfWork _inner = new(db);
        public TaskCompletionSource Entered { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource Resume { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public bool HasActiveTransaction => _inner.HasActiveTransaction;

        public async Task<int> SaveChangesAsync(CancellationToken cancellationToken = default)
        {
            Entered.TrySetResult();
            await Resume.Task.WaitAsync(cancellationToken);
            return await _inner.SaveChangesAsync(cancellationToken);
        }

        public Task BeginTransactionAsync(CancellationToken cancellationToken = default) =>
            _inner.BeginTransactionAsync(cancellationToken);
        public Task CommitTransactionAsync(CancellationToken cancellationToken = default) =>
            _inner.CommitTransactionAsync(cancellationToken);
        public Task RollbackTransactionAsync(CancellationToken cancellationToken = default) =>
            _inner.RollbackTransactionAsync(cancellationToken);
        public void Dispose() => _inner.Dispose();
    }
}
