using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Planora.BuildingBlocks.Application.Context;
using Planora.BuildingBlocks.Application.Messaging.Events;
using Planora.BuildingBlocks.Application.Outbox;
using Planora.Collaboration.Application.DTOs;
using Planora.Collaboration.Application.Features.Comments.Commands.AddComment;
using Planora.Collaboration.Application.Features.Comments.Commands.DeleteComment;
using Planora.Collaboration.Application.Features.Comments.Commands.UpdateComment;
using Planora.Collaboration.Application.Services;
using Planora.Collaboration.Domain.Entities;
using Planora.Collaboration.Domain.Enums;
using Planora.Collaboration.Infrastructure.Persistence;
using Planora.Collaboration.Infrastructure.Persistence.Repositories;
using Planora.UnitTests.BuildingBlocks.Retention.Postgres;

namespace Planora.UnitTests.Services.CollaborationApi.Infrastructure;

public sealed class CommentMutationOutboxPostgresTests
{
    [PostgresFact]
    public async Task AddReplyAsync_LastRecipientFailureLeavesNoNewCommentOrEvents()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        var seed = await SeedAsync(database, timeout.Token);
        await using var context = new CollaborationDbContext(database.Options<CollaborationDbContext>());
        var failure = new IOException("Synthetic last comment recipient failure");
        var outbox = new ControlledOutbox(new OutboxRepository(context), attempt =>
        {
            if (attempt == 4) throw failure;
        });

        var thrown = await Assert.ThrowsAsync<IOException>(() =>
            InvokeAsync(context, seed, outbox, Mode.AddReply, timeout.Token));

        Assert.Same(failure, thrown);
        Assert.Equal(4, outbox.AttemptedMessages.Count);
        await AssertRolledBackAsync(database, seed, timeout.Token);
    }

    [PostgresFact]
    public async Task AddReplyAsync_RejectedNotificationInsertRollsBackCommentAndBranchSignal()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        var seed = await SeedAsync(database, timeout.Token);
        await using var context = new CollaborationDbContext(database.Options<CollaborationDbContext>());
        await context.Database.ExecuteSqlRawAsync("""
            ALTER TABLE collaboration."OutboxMessages" ADD CONSTRAINT reject_notification
            CHECK ("Type" NOT LIKE '%NotificationEvent%')
            """, timeout.Token);
        var outbox = new ControlledOutbox(new OutboxRepository(context));

        await Assert.ThrowsAsync<DbUpdateException>(() =>
            InvokeAsync(context, seed, outbox, Mode.AddReply, timeout.Token));

        await AssertRolledBackAsync(database, seed, timeout.Token);
    }

    [PostgresFact]
    public Task UpdateReplyAsync_EventFailurePreservesOldContentAndEditedState() =>
        AssertFirstEventFailureAsync(Mode.UpdateReply);

    [PostgresFact]
    public async Task UpdateReplyAsync_UnexpectedProfileFailureLeavesStoredReplyAndEventsUntouched()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        var seed = await SeedAsync(database, timeout.Token);
        await using var context = new CollaborationDbContext(database.Options<CollaborationDbContext>());
        var failure = new IOException("Synthetic unexpected profile dependency failure");
        var users = new Mock<IUserService>();
        users.Setup(service => service.GetUserProfilesAsync(It.IsAny<IEnumerable<Guid>>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(failure);
        var outbox = new ControlledOutbox(new OutboxRepository(context));

        var thrown = await Assert.ThrowsAsync<IOException>(() =>
            InvokeAsync(context, seed, outbox, Mode.UpdateReply, timeout.Token, users: users.Object));

        Assert.Same(failure, thrown);
        users.Verify(service => service.GetUserProfilesAsync(It.IsAny<IEnumerable<Guid>>(), It.IsAny<CancellationToken>()), Times.Once);
        await AssertRolledBackAsync(database, seed, timeout.Token);
    }

    [PostgresFact]
    public Task DeleteReplyAsync_EventFailureLeavesCommentAlive() =>
        AssertFirstEventFailureAsync(Mode.DeleteReply);

    [PostgresFact]
    public async Task AddReplyAsync_CancellationBeforeLastRecipientRollsBackCommentAndEvents()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        using var requestCancellation = new CancellationTokenSource();
        var seed = await SeedAsync(database, timeout.Token);
        await using var context = new CollaborationDbContext(database.Options<CollaborationDbContext>());
        var outbox = new ControlledOutbox(new OutboxRepository(context), attempt =>
        {
            if (attempt == 4) requestCancellation.Cancel();
        });

        var thrown = await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            InvokeAsync(context, seed, outbox, Mode.AddReply, requestCancellation.Token));

        Assert.Equal(requestCancellation.Token, thrown.CancellationToken);
        Assert.Equal(4, outbox.AttemptedMessages.Count);
        await AssertRolledBackAsync(database, seed, timeout.Token);
    }

    [PostgresFact]
    public async Task AddReplyAsync_FailedStagingThenFreshContextRetryCreatesOnlyOneReplyAndEventSet()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        var seed = await SeedAsync(database, timeout.Token);
        await using var failedContext = new CollaborationDbContext(database.Options<CollaborationDbContext>());
        var failure = new IOException("Synthetic failed attempt before retry");
        var failedOutbox = new ControlledOutbox(new OutboxRepository(failedContext), attempt =>
        {
            if (attempt == 4) throw failure;
        });
        var thrown = await Assert.ThrowsAsync<IOException>(() =>
            InvokeAsync(failedContext, seed, failedOutbox, Mode.AddReply, timeout.Token));
        Assert.Same(failure, thrown);
        await AssertRolledBackAsync(database, seed, timeout.Token);

        await using var retryContext = new CollaborationDbContext(database.Options<CollaborationDbContext>());
        var retryOutbox = new ControlledOutbox(new OutboxRepository(retryContext));
        var dto = await InvokeAsync(retryContext, seed, retryOutbox, Mode.AddReply, timeout.Token);

        await using var observer = new CollaborationDbContext(database.Options<CollaborationDbContext>());
        var rows = await AssertDataAsync(observer, seed, Mode.AddReply, seed.ActorId, timeout.Token);
        var added = Assert.Single(rows, row => row.Id == dto!.Id);
        AssertDto(dto!, added, seed, Mode.AddReply);
        await AssertEventsAsync(observer, seed, Mode.AddReply, added.Id, seed.ActorId, timeout.Token);
        Assert.Equal(4, retryOutbox.AttemptedMessages.Count);
    }

    [PostgresFact]
    public async Task CommentMutationsAsync_SuccessMatrixCommitsCompleteEventsAndPreservesQuoteAndOtherRows()
    {
        foreach (var mode in Enum.GetValues<Mode>())
        {
            await using var database = await TemporaryDatabase.CreateAsync();
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
            var seed = await SeedAsync(database, timeout.Token);
            await using var context = new CollaborationDbContext(database.Options<CollaborationDbContext>());
            var outbox = new ControlledOutbox(new OutboxRepository(context));
            var deleteAsOwner = mode == Mode.DeleteReply;

            var dto = await InvokeAsync(context, seed, outbox, mode, timeout.Token, deleteAsOwner);

            await using var observer = new CollaborationDbContext(database.Options<CollaborationDbContext>());
            var actorId = deleteAsOwner ? seed.OwnerId : seed.ActorId;
            var rows = await AssertDataAsync(observer, seed, mode, actorId, timeout.Token);
            var target = mode == Mode.AddReply
                ? Assert.Single(rows, row => row.Id != seed.Quote.Id && row.Id != seed.Reply.Id && row.Id != seed.Unrelated.Id)
                : Assert.Single(rows, row => row.Id == seed.Reply.Id);
            if (mode != Mode.DeleteReply)
                AssertDto(dto!, target, seed, mode);
            else
                Assert.Null(dto);
            await AssertEventsAsync(observer, seed, mode, target.Id, actorId, timeout.Token);
            Assert.Equal(mode == Mode.AddReply ? 4 : 1, outbox.AttemptedMessages.Count);
        }
    }

    private static async Task AssertFirstEventFailureAsync(Mode mode)
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        var seed = await SeedAsync(database, timeout.Token);
        await using var context = new CollaborationDbContext(database.Options<CollaborationDbContext>());
        var failure = new IOException("Synthetic first comment event failure");
        var outbox = new ControlledOutbox(new OutboxRepository(context), _ => throw failure);

        var thrown = await Assert.ThrowsAsync<IOException>(() =>
            InvokeAsync(context, seed, outbox, mode, timeout.Token));

        Assert.Same(failure, thrown);
        Assert.Single(outbox.AttemptedMessages);
        await AssertRolledBackAsync(database, seed, timeout.Token);
    }

    private static async Task<CommentDto?> InvokeAsync(
        CollaborationDbContext context, Seed seed, IOutboxRepository outbox, Mode mode, CancellationToken token,
        bool deleteAsOwner = false, IUserService? users = null)
    {
        var actorId = deleteAsOwner ? seed.OwnerId : seed.ActorId;
        var currentUser = new Mock<ICurrentUserContext>();
        currentUser.SetupGet(user => user.UserId).Returns(actorId);
        currentUser.SetupGet(user => user.Name).Returns(deleteAsOwner ? "Audit Owner" : "Audit Actor");
        currentUser.SetupGet(user => user.ProfilePictureUrl).Returns("/synthetic/current-actor.png");
        var access = new Mock<ITaskAccessService>();
        access.Setup(service => service.CheckCommentAccessAsync(seed.TaskId, actorId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new TaskAccessResult(true, true, seed.OwnerId,
                new[] { seed.OwnerId, seed.ActorId, seed.Quote.AuthorId, seed.OtherParticipantId }, string.Empty, null));
        var profiles = new Mock<IUserService>();
        profiles.Setup(service => service.GetUserProfilesAsync(It.IsAny<IEnumerable<Guid>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new Dictionary<Guid, UserProfile>
            {
                [seed.ActorId] = new("Live Actor", "/synthetic/live-actor.png"),
                [seed.Quote.AuthorId] = new("Live Quoted", "/synthetic/live-quoted.png"),
            });
        users ??= profiles.Object;
        var repository = new CommentRepository(context);
        var unitOfWork = new CollaborationUnitOfWork(context);
        switch (mode)
        {
            case Mode.AddReply:
            {
                var handler = new AddCommentCommandHandler(repository, unitOfWork, currentUser.Object, access.Object, outbox, users);
                var result = await handler.Handle(new AddCommentCommand(seed.TaskId, "New reply text", "comment", seed.Quote.Id), token);
                Assert.True(result.IsSuccess);
                return result.Value!;
            }
            case Mode.UpdateReply:
            {
                var handler = new UpdateCommentCommandHandler(repository, unitOfWork, currentUser.Object, users, access.Object, outbox);
                var result = await handler.Handle(new UpdateCommentCommand(seed.TaskId, seed.Reply.Id, "Edited reply text"), token);
                Assert.True(result.IsSuccess);
                return result.Value!;
            }
            default:
            {
                var handler = new DeleteCommentCommandHandler(repository, unitOfWork, currentUser.Object, access.Object, outbox);
                var result = await handler.Handle(new DeleteCommentCommand(seed.TaskId, seed.Reply.Id), token);
                Assert.True(result.IsSuccess);
                return null;
            }
        }
    }

    private static async Task<Seed> SeedAsync(TemporaryDatabase database, CancellationToken token)
    {
        await using var context = new CollaborationDbContext(database.Options<CollaborationDbContext>());
        await CollaborationDatabaseStartup.EnsureReadyAsync(context, NullLogger.Instance, token);
        var taskId = Guid.NewGuid();
        var ownerId = Guid.NewGuid();
        var actorId = Guid.NewGuid();
        var otherParticipantId = Guid.NewGuid();
        var quote = Comment.Create(taskId, Guid.NewGuid(), "Stored Quoted", "First quoted line\nSecond quoted line");
        var reply = Comment.CreateReply(taskId, actorId, "Stored Actor", "Original reply text",
            ReplyTargetType.Comment, quote.Id, quote.AuthorId, "Stored quote snapshot", "Stored quote excerpt");
        var unrelated = Comment.Create(Guid.NewGuid(), otherParticipantId, "Other Author", "Unrelated branch content");
        RetentionTestKit.Set(quote, nameof(Comment.CreatedAt), DateTime.UtcNow.AddMinutes(-10));
        RetentionTestKit.Set(reply, nameof(Comment.CreatedAt), DateTime.UtcNow.AddMinutes(-5));
        RetentionTestKit.Set(unrelated, nameof(Comment.CreatedAt), DateTime.UtcNow.AddMinutes(-7));
        context.Comments.AddRange(quote, reply, unrelated);
        await context.SaveChangesAsync(token);
        var rows = await ReadCommentsAsync(context, token);
        return new Seed(taskId, ownerId, actorId, otherParticipantId,
            Assert.Single(rows, row => row.Id == quote.Id),
            Assert.Single(rows, row => row.Id == reply.Id),
            Assert.Single(rows, row => row.Id == unrelated.Id));
    }

    private static Task<List<Comment>> ReadCommentsAsync(CollaborationDbContext context, CancellationToken token) =>
        context.Comments.IgnoreQueryFilters().AsNoTracking().ToListAsync(token);

    private static async Task AssertRolledBackAsync(TemporaryDatabase database, Seed seed, CancellationToken token)
    {
        await using var observer = new CollaborationDbContext(database.Options<CollaborationDbContext>());
        await AssertDataAsync(observer, seed, committed: null, seed.ActorId, token);
        Assert.Empty(await observer.OutboxMessages.AsNoTracking().ToListAsync(token));
    }

    private static async Task<List<Comment>> AssertDataAsync(
        CollaborationDbContext observer, Seed seed, Mode? committed, Guid actorId, CancellationToken token)
    {
        var rows = await ReadCommentsAsync(observer, token);
        Assert.Equal(committed == Mode.AddReply ? 4 : 3, rows.Count);
        foreach (var expected in new[] { seed.Quote, seed.Reply, seed.Unrelated })
        {
            var actual = Assert.Single(rows, row => row.Id == expected.Id);
            AssertStaticFields(expected, actual);
            if (expected.Id == seed.Reply.Id && committed == Mode.UpdateReply)
            {
                Assert.Equal("Edited reply text", actual.Content);
                Assert.NotNull(actual.UpdatedAt);
                Assert.Equal(seed.ActorId, actual.UpdatedBy);
                Assert.True(actual.IsEdited);
            }
            else
            {
                Assert.Equal((expected.Content, expected.UpdatedAt, expected.UpdatedBy, expected.IsEdited),
                    (actual.Content, actual.UpdatedAt, actual.UpdatedBy, actual.IsEdited));
            }
            if (expected.Id == seed.Reply.Id && committed == Mode.DeleteReply)
            {
                Assert.True(actual.IsDeleted);
                Assert.NotNull(actual.DeletedAt);
                Assert.Equal(actorId, actual.DeletedBy);
            }
            else
            {
                Assert.Equal((expected.IsDeleted, expected.DeletedAt, expected.DeletedBy),
                    (actual.IsDeleted, actual.DeletedAt, actual.DeletedBy));
            }
        }
        if (committed == Mode.AddReply)
        {
            var added = Assert.Single(rows, row => row.Id != seed.Quote.Id && row.Id != seed.Reply.Id && row.Id != seed.Unrelated.Id);
            Assert.Equal((seed.TaskId, seed.ActorId, "Audit Actor", "New reply text"),
                (added.TaskId, added.AuthorId, added.AuthorName, added.Content));
            Assert.Equal(ReplyTargetType.Comment, added.ReplyToType);
            Assert.Equal(seed.Quote.Id, added.ReplyToId);
            Assert.Equal(seed.Quote.AuthorId, added.ReplyToAuthorId);
            Assert.Equal("Live Quoted", added.ReplyToAuthorName);
            Assert.Equal("First quoted line Second quoted line", added.ReplyToPreview);
            Assert.False(added.ReplyToDeleted);
            Assert.False(added.IsDeleted);
            Assert.False(added.IsSystemComment);
            Assert.False(added.IsGenesisComment);
            Assert.False(added.IsEdited);
        }
        return rows;
    }

    private static void AssertStaticFields(Comment expected, Comment actual)
    {
        Assert.Equal((expected.Id, expected.TaskId, expected.AuthorId, expected.AuthorName),
            (actual.Id, actual.TaskId, actual.AuthorId, actual.AuthorName));
        Assert.Equal((expected.CreatedAt, expected.CreatedBy, expected.IsSystemComment, expected.IsGenesisComment),
            (actual.CreatedAt, actual.CreatedBy, actual.IsSystemComment, actual.IsGenesisComment));
        Assert.Equal((expected.ReplyToType, expected.ReplyToId, expected.ReplyToAuthorId, expected.ReplyToAuthorName,
                expected.ReplyToPreview, expected.ReplyToDeleted),
            (actual.ReplyToType, actual.ReplyToId, actual.ReplyToAuthorId, actual.ReplyToAuthorName,
                actual.ReplyToPreview, actual.ReplyToDeleted));
    }

    private static void AssertDto(CommentDto dto, Comment stored, Seed seed, Mode mode)
    {
        Assert.Equal((stored.Id, seed.TaskId, seed.ActorId, stored.Content),
            (dto.Id, dto.TodoItemId, dto.AuthorId, dto.Content));
        // PostgreSQL stores microseconds; the immediate DTO can retain sub-microsecond CLR ticks.
        Assert.Equal(stored.CreatedAt.Ticks / TimeSpan.TicksPerMicrosecond,
            dto.CreatedAt.Ticks / TimeSpan.TicksPerMicrosecond);
        Assert.Equal(stored.UpdatedAt?.Ticks / TimeSpan.TicksPerMicrosecond,
            dto.UpdatedAt?.Ticks / TimeSpan.TicksPerMicrosecond);
        Assert.Equal(stored.CreatedAt.Kind, dto.CreatedAt.Kind);
        if (stored.UpdatedAt is { } updatedAt)
            Assert.Equal(updatedAt.Kind, dto.UpdatedAt!.Value.Kind);
        Assert.Equal(mode == Mode.AddReply ? "Audit Actor" : "Live Actor", dto.AuthorName);
        Assert.Equal(mode == Mode.AddReply ? "/synthetic/current-actor.png" : "/synthetic/live-actor.png", dto.AuthorAvatarUrl);
        Assert.True(dto.IsOwn);
        Assert.Equal(mode == Mode.UpdateReply, dto.IsEdited);
        Assert.False(dto.IsSystemComment);
        Assert.False(dto.IsGenesisComment);
        Assert.Equal("comment", dto.ReplyToType);
        Assert.Equal(seed.Quote.Id, dto.ReplyToId);
        Assert.Equal(seed.Quote.AuthorId, dto.ReplyToAuthorId);
        Assert.Equal("Live Quoted", dto.ReplyToAuthorName);
        Assert.Equal("/synthetic/live-quoted.png", dto.ReplyToAuthorAvatarUrl);
        Assert.Equal(mode == Mode.AddReply ? "First quoted line Second quoted line" : "Stored quote excerpt", dto.ReplyToPreview);
        Assert.False(dto.ReplyToDeleted);
    }

    private static async Task AssertEventsAsync(
        CollaborationDbContext observer, Seed seed, Mode mode, Guid commentId, Guid actorId, CancellationToken token)
    {
        var messages = await observer.OutboxMessages.AsNoTracking().ToListAsync(token);
        Assert.Equal(mode == Mode.AddReply ? 4 : 1, messages.Count);
        Assert.All(messages, message => Assert.Equal(OutboxMessageStatus.Pending, message.Status));
        var sync = JsonSerializer.Deserialize<RealtimeSyncIntegrationEvent>(
            Assert.Single(messages, message => message.Type == typeof(RealtimeSyncIntegrationEvent).AssemblyQualifiedName).Content)!;
        Assert.Equal(commentId, sync.EntityId);
        Assert.Equal(seed.TaskId, sync.BranchTaskId);
        Assert.Equal(actorId, sync.ActorId);
        Assert.Empty(sync.AudienceUserIds);
        Assert.Equal(mode switch
        {
            Mode.AddReply => RealtimeSyncAction.CommentAdded,
            Mode.UpdateReply => RealtimeSyncAction.CommentUpdated,
            _ => RealtimeSyncAction.CommentDeleted,
        }, sync.Action);
        if (mode != Mode.AddReply) return;
        var notifications = messages.Where(message => message.Type == typeof(NotificationEvent).AssemblyQualifiedName)
            .Select(message => JsonSerializer.Deserialize<NotificationEvent>(message.Content)!).ToArray();
        Assert.Equal(new[] { seed.OwnerId, seed.Quote.AuthorId, seed.OtherParticipantId }.OrderBy(id => id),
            notifications.Select(notification => notification.UserId).OrderBy(id => id));
        Assert.All(notifications, notification =>
        {
            var quoted = notification.UserId == seed.Quote.AuthorId;
            Assert.NotEqual(seed.ActorId, notification.UserId);
            Assert.NotEqual(Guid.Empty, notification.UserId);
            Assert.Equal(seed.TaskId, notification.TaskId);
            Assert.Equal(seed.ActorId, notification.ActorId);
            Assert.Equal(quoted ? NotificationType.CommentReply : NotificationType.CommentAdded, notification.Type);
            Assert.Equal(quoted ? "New reply" : "New comment", notification.Title);
            Assert.Equal(quoted ? "Audit Actor replied to your message" : "Audit Actor commented on a task", notification.Message);
        });
    }

    private enum Mode { AddReply, UpdateReply, DeleteReply }

    private sealed record Seed(Guid TaskId, Guid OwnerId, Guid ActorId, Guid OtherParticipantId,
        Comment Quote, Comment Reply, Comment Unrelated);

    private sealed class ControlledOutbox(IOutboxRepository inner, Action<int>? beforeWrite = null) : IOutboxRepository
    {
        public List<OutboxMessage> AttemptedMessages { get; } = [];
        public Task StageAsync(OutboxMessage message, CancellationToken cancellationToken = default)
        {
            BeforeWrite(message);
            return inner.StageAsync(message, cancellationToken);
        }
        public Task AddAsync(OutboxMessage message, CancellationToken cancellationToken = default)
        {
            BeforeWrite(message);
            return inner.AddAsync(message, cancellationToken);
        }
        private void BeforeWrite(OutboxMessage message)
        {
            AttemptedMessages.Add(message);
            beforeWrite?.Invoke(AttemptedMessages.Count);
        }
        public Task<IReadOnlyList<OutboxMessage>> GetPendingMessagesAsync(int batchSize, CancellationToken cancellationToken = default) =>
            inner.GetPendingMessagesAsync(batchSize, cancellationToken);
        public Task UpdateAsync(OutboxMessage message, CancellationToken cancellationToken = default) =>
            inner.UpdateAsync(message, cancellationToken);
        public Task DeleteProcessedMessagesAsync(DateTime olderThan, CancellationToken cancellationToken = default) =>
            inner.DeleteProcessedMessagesAsync(olderThan, cancellationToken);
    }
}
