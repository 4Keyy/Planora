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

    [Fact]
    [Trait("TestType", "Integration")]
    public async Task TaskCreated_WithDescription_WritesSystemAndGenesisComments()
    {
        var taskId = Guid.NewGuid();
        var owner = Guid.NewGuid();
        var comments = new Mock<ICommentRepository>();
        var uow = new Mock<IUnitOfWork>();
        var added = new List<Comment>();
        comments.Setup(x => x.AddAsync(It.IsAny<Comment>(), It.IsAny<CancellationToken>()))
            .Callback<Comment, CancellationToken>((c, _) => added.Add(c))
            .ReturnsAsync((Comment c, CancellationToken _) => c);
        comments.Setup(x => x.GetGenesisCommentAsync(taskId, It.IsAny<CancellationToken>()))
            .ReturnsAsync((Comment?)null);

        var consumer = new TaskCreatedEventConsumer(comments.Object, uow.Object,
            Mock.Of<ILogger<TaskCreatedEventConsumer>>());

        await consumer.HandleAsync(
            new TaskCreatedIntegrationEvent(taskId, owner, "Alice", "My description"), CancellationToken.None);

        Assert.Equal(2, added.Count);
        Assert.Contains(added, c => c.IsSystemComment && !c.IsGenesisComment && c.Content.Contains("created the task"));
        Assert.Contains(added, c => c.IsGenesisComment && c.Content == "My description");
        uow.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    [Trait("TestType", "Functional")]
    public async Task TaskCreated_WithoutDescription_WritesOnlySystemComment()
    {
        var taskId = Guid.NewGuid();
        var comments = new Mock<ICommentRepository>();
        var added = new List<Comment>();
        comments.Setup(x => x.AddAsync(It.IsAny<Comment>(), It.IsAny<CancellationToken>()))
            .Callback<Comment, CancellationToken>((c, _) => added.Add(c))
            .ReturnsAsync((Comment c, CancellationToken _) => c);

        var consumer = new TaskCreatedEventConsumer(comments.Object, Mock.Of<IUnitOfWork>(),
            Mock.Of<ILogger<TaskCreatedEventConsumer>>());

        await consumer.HandleAsync(
            new TaskCreatedIntegrationEvent(taskId, Guid.NewGuid(), "Bob", null), CancellationToken.None);

        Assert.Single(added);
        Assert.True(added[0].IsSystemComment);
        Assert.False(added[0].IsGenesisComment);
        comments.Verify(x => x.GetGenesisCommentAsync(It.IsAny<Guid>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    [Trait("TestType", "Regression")]
    public async Task TaskCreated_Replay_DoesNotDuplicateGenesis()
    {
        var taskId = Guid.NewGuid();
        var comments = new Mock<ICommentRepository>();
        var added = new List<Comment>();
        comments.Setup(x => x.AddAsync(It.IsAny<Comment>(), It.IsAny<CancellationToken>()))
            .Callback<Comment, CancellationToken>((c, _) => added.Add(c))
            .ReturnsAsync((Comment c, CancellationToken _) => c);
        // Genesis already exists from a prior delivery.
        comments.Setup(x => x.GetGenesisCommentAsync(taskId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(Comment.CreateGenesis(taskId, "existing", "Alice"));

        var consumer = new TaskCreatedEventConsumer(comments.Object, Mock.Of<IUnitOfWork>(),
            Mock.Of<ILogger<TaskCreatedEventConsumer>>());

        await consumer.HandleAsync(
            new TaskCreatedIntegrationEvent(taskId, Guid.NewGuid(), "Alice", "desc"), CancellationToken.None);

        // Only the system comment is added; genesis is NOT re-created.
        Assert.Single(added);
        Assert.True(added[0].IsSystemComment && !added[0].IsGenesisComment);
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

    // ─── UserDeleted ────────────────────────────────────────────────────────────

    [Fact]
    [Trait("TestType", "Integration")]
    public async Task UserDeleted_SoftDeletesAuthoredComments()
    {
        var userId = Guid.NewGuid();
        var taskId = Guid.NewGuid();
        var authored = new List<Comment>
        {
            Comment.Create(taskId, userId, "U", "one"),
            Comment.Create(taskId, userId, "U", "two"),
        };
        var comments = new Mock<ICommentRepository>();
        comments.Setup(x => x.FindAsync(It.IsAny<System.Linq.Expressions.Expression<Func<Comment, bool>>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(authored);
        var uow = new Mock<IUnitOfWork>();

        var consumer = new UserDeletedEventConsumer(comments.Object, uow.Object,
            Mock.Of<ILogger<UserDeletedEventConsumer>>());

        await consumer.HandleAsync(new UserDeletedIntegrationEvent(userId, "u@planora.dev"), CancellationToken.None);

        Assert.All(authored, c => Assert.True(c.IsDeleted));
        uow.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    [Trait("TestType", "Functional")]
    public async Task UserDeleted_NoComments_IsNoOp()
    {
        var comments = new Mock<ICommentRepository>();
        comments.Setup(x => x.FindAsync(It.IsAny<System.Linq.Expressions.Expression<Func<Comment, bool>>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new List<Comment>());
        var uow = new Mock<IUnitOfWork>();

        var consumer = new UserDeletedEventConsumer(comments.Object, uow.Object,
            Mock.Of<ILogger<UserDeletedEventConsumer>>());

        await consumer.HandleAsync(new UserDeletedIntegrationEvent(Guid.NewGuid(), "u@planora.dev"), CancellationToken.None);

        uow.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Never);
    }
}
