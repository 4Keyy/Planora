using Planora.BuildingBlocks.Application.Messaging.Events;
using Planora.BuildingBlocks.Domain.Interfaces;
using Planora.Collaboration.Application.Features.IntegrationEvents;
using Planora.Collaboration.Domain.Entities;
using Planora.Collaboration.Domain.Repositories;
using Microsoft.Extensions.Logging;
using Moq;

namespace Planora.UnitTests.Services.CollaborationApi.IntegrationEvents;

/// <summary>
/// Covers the Inbox side: task-lifecycle integration events from TodoApi are
/// materialised into the timeline. Replays must be idempotent (INV-COMM-4).
/// </summary>
public sealed class IntegrationEventConsumerTests
{
    // ─── TaskCreated ────────────────────────────────────────────────────────────

    [Theory]
    [Trait("TestType", "Integration")]
    [InlineData("My description")]
    [InlineData(null)]
    public async Task TaskCreated_WritesOnlyTheCreatedSystemComment(string? description)
    {
        // The description ("Author's Note") is no longer copied into a genesis comment — it stays
        // a single source of truth in Todo and is synthesised on read. So task creation only ever
        // materialises the "created the task" system comment, regardless of the description.
        var taskId = Guid.NewGuid();
        var comments = new Mock<ICommentRepository>();
        var uow = new Mock<IUnitOfWork>();
        var added = new List<Comment>();
        comments.Setup(x => x.AddAsync(It.IsAny<Comment>(), It.IsAny<CancellationToken>()))
            .Callback<Comment, CancellationToken>((c, _) => added.Add(c))
            .ReturnsAsync((Comment c, CancellationToken _) => c);

        var consumer = new TaskCreatedEventConsumer(comments.Object, uow.Object,
            Mock.Of<ILogger<TaskCreatedEventConsumer>>());

        await consumer.HandleAsync(
            new TaskCreatedIntegrationEvent(taskId, Guid.NewGuid(), "Alice", description), CancellationToken.None);

        Assert.Single(added);
        Assert.True(added[0].IsSystemComment && !added[0].IsGenesisComment);
        Assert.Contains("created the task", added[0].Content);
        uow.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Once);
    }

    // ─── TaskActivity ───────────────────────────────────────────────────────────

    [Theory]
    [Trait("TestType", "Functional")]
    [InlineData(TaskActivityType.Completed, "completed the task")]
    [InlineData(TaskActivityType.StartedWorking, "started working on the task")]
    [InlineData(TaskActivityType.Left, "left the task")]
    public async Task TaskActivity_WritesExpectedSystemComment(string activity, string expectedFragment)
    {
        var taskId = Guid.NewGuid();
        var comments = new Mock<ICommentRepository>();
        Comment? captured = null;
        comments.Setup(x => x.AddAsync(It.IsAny<Comment>(), It.IsAny<CancellationToken>()))
            .Callback<Comment, CancellationToken>((c, _) => captured = c)
            .ReturnsAsync((Comment c, CancellationToken _) => c);

        var consumer = new TaskActivityEventConsumer(comments.Object, Mock.Of<IUnitOfWork>(),
            Mock.Of<ILogger<TaskActivityEventConsumer>>());

        await consumer.HandleAsync(
            new TaskActivityIntegrationEvent(taskId, Guid.NewGuid(), "Carol", activity), CancellationToken.None);

        Assert.NotNull(captured);
        Assert.True(captured!.IsSystemComment);
        Assert.Contains(expectedFragment, captured.Content);
        Assert.Contains("Carol", captured.Content);
    }

    [Theory]
    [Trait("TestType", "Functional")]
    [InlineData(TaskActivityType.SubtaskCreated, "added a subtask: Draft outline")]
    [InlineData(TaskActivityType.SubtaskCompleted, "completed a subtask: Draft outline")]
    public async Task SubtaskActivity_WritesSystemCommentWithTitle(string activity, string expectedFragment)
    {
        var parentId = Guid.NewGuid();
        var comments = new Mock<ICommentRepository>();
        Comment? captured = null;
        comments.Setup(x => x.AddAsync(It.IsAny<Comment>(), It.IsAny<CancellationToken>()))
            .Callback<Comment, CancellationToken>((c, _) => captured = c)
            .ReturnsAsync((Comment c, CancellationToken _) => c);

        var consumer = new TaskActivityEventConsumer(comments.Object, Mock.Of<IUnitOfWork>(),
            Mock.Of<ILogger<TaskActivityEventConsumer>>());

        await consumer.HandleAsync(
            new TaskActivityIntegrationEvent(parentId, Guid.NewGuid(), "Dave", activity, "Draft outline"),
            CancellationToken.None);

        Assert.NotNull(captured);
        Assert.True(captured!.IsSystemComment);
        Assert.Equal(parentId, captured.TaskId); // posted to the PARENT's branch
        Assert.Contains("Dave", captured.Content);
        Assert.Contains(expectedFragment, captured.Content);
    }

    [Fact]
    [Trait("TestType", "Resilience")]
    public async Task TaskActivity_UnknownType_IsSkippedSilently()
    {
        var comments = new Mock<ICommentRepository>();
        var consumer = new TaskActivityEventConsumer(comments.Object, Mock.Of<IUnitOfWork>(),
            Mock.Of<ILogger<TaskActivityEventConsumer>>());

        await consumer.HandleAsync(
            new TaskActivityIntegrationEvent(Guid.NewGuid(), Guid.NewGuid(), "X", "BogusType"), CancellationToken.None);

        comments.Verify(x => x.AddAsync(It.IsAny<Comment>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    // ─── TaskDeleted ────────────────────────────────────────────────────────────

    [Fact]
    [Trait("TestType", "Integration")]
    public async Task TaskDeleted_CascadeSoftDeletesTimeline()
    {
        var taskId = Guid.NewGuid();
        var actor = Guid.NewGuid();
        var comments = new Mock<ICommentRepository>();
        var uow = new Mock<IUnitOfWork>();

        var consumer = new TaskDeletedEventConsumer(comments.Object, uow.Object,
            Mock.Of<ILogger<TaskDeletedEventConsumer>>());

        await consumer.HandleAsync(new TaskDeletedIntegrationEvent(taskId, actor), CancellationToken.None);

        comments.Verify(x => x.SoftDeleteByTaskIdAsync(taskId, actor, It.IsAny<CancellationToken>()), Times.Once);
        uow.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Once);
    }

    // ─── SubtaskDeleted ─────────────────────────────────────────────────────────

    [Fact]
    [Trait("TestType", "Integration")]
    public async Task SubtaskDeleted_SoftDeletesOnlyTheSubtaskAnnouncementsInParentBranch()
    {
        var parentId = Guid.NewGuid();
        var subtaskId = Guid.NewGuid();
        var actor = Guid.NewGuid();
        var comments = new Mock<ICommentRepository>();
        var uow = new Mock<IUnitOfWork>();

        var consumer = new SubtaskDeletedEventConsumer(comments.Object, uow.Object,
            Mock.Of<ILogger<SubtaskDeletedEventConsumer>>());

        await consumer.HandleAsync(
            new SubtaskDeletedIntegrationEvent(parentId, subtaskId, actor, "Draft outline"),
            CancellationToken.None);

        // Targets the parent branch + title (not a whole-branch wipe).
        comments.Verify(x => x.SoftDeleteSubtaskActivityAsync(
            parentId, "Draft outline", actor, It.IsAny<CancellationToken>()), Times.Once);
        comments.Verify(x => x.SoftDeleteByTaskIdAsync(
            It.IsAny<Guid>(), It.IsAny<Guid>(), It.IsAny<CancellationToken>()), Times.Never);
        uow.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Once);
    }

    // ─── UserDeleted ────────────────────────────────────────────────────────────

    [Fact]
    [Trait("TestType", "Integration")]
    public async Task UserDeleted_SoftDeletesAuthoredComments()
    {
        var userId = Guid.NewGuid();
        var comments = new Mock<ICommentRepository>();
        // Tracked soft-delete (xmin-safe) reports how many comments it removed.
        comments.Setup(x => x.SoftDeleteByAuthorAsync(userId, userId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(2);
        var uow = new Mock<IUnitOfWork>();

        var consumer = new UserDeletedEventConsumer(comments.Object, uow.Object,
            Mock.Of<ILogger<UserDeletedEventConsumer>>());

        await consumer.HandleAsync(new UserDeletedIntegrationEvent(userId, "u@planora.dev"), CancellationToken.None);

        comments.Verify(x => x.SoftDeleteByAuthorAsync(userId, userId, It.IsAny<CancellationToken>()), Times.Once);
        uow.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    [Trait("TestType", "Functional")]
    public async Task UserDeleted_NoComments_IsNoOp()
    {
        var comments = new Mock<ICommentRepository>();
        comments.Setup(x => x.SoftDeleteByAuthorAsync(It.IsAny<Guid>(), It.IsAny<Guid>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(0);
        var uow = new Mock<IUnitOfWork>();

        var consumer = new UserDeletedEventConsumer(comments.Object, uow.Object,
            Mock.Of<ILogger<UserDeletedEventConsumer>>());

        await consumer.HandleAsync(new UserDeletedIntegrationEvent(Guid.NewGuid(), "u@planora.dev"), CancellationToken.None);

        uow.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Never);
    }
}
