using Planora.BuildingBlocks.Application.Context;
using Planora.BuildingBlocks.Application.Messaging.Events;
using Planora.BuildingBlocks.Application.Outbox;
using Planora.BuildingBlocks.Domain.Exceptions;
using Planora.BuildingBlocks.Domain.Interfaces;
using Planora.Collaboration.Application.Features.Comments.Commands.AddComment;
using Planora.Collaboration.Application.Features.Comments.Commands.DeleteComment;
using Planora.Collaboration.Application.Features.Comments.Commands.UpdateComment;
using Planora.Collaboration.Application.Services;
using Planora.Collaboration.Domain.Entities;
using Planora.Collaboration.Domain.Repositories;
using Moq;

namespace Planora.UnitTests.Services.CollaborationApi.Handlers;

/// <summary>
/// Behavioural coverage for the comment command handlers. Mirrors the access matrix the
/// former TodoApi handlers enforced, now delegated to <see cref="ITaskAccessService"/>.
/// </summary>
public sealed class CommentCommandHandlerTests
{
    // ─── AddComment ─────────────────────────────────────────────────────────────

    [Fact]
    [Trait("TestType", "Functional")]
    public async Task AddComment_WithAccess_PersistsAndFansOutNotifications()
    {
        var fixture = new Fixture();
        var owner = Guid.NewGuid();
        var author = fixture.UserId;
        fixture.GrantAccess(owner, participants: new[] { owner, author, Guid.NewGuid() });

        var result = await fixture.AddHandler().Handle(
            new AddCommentCommand(fixture.TaskId, "Hello team"), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal("Hello team", result.Value!.Content);
        Assert.True(result.Value.IsOwn);
        fixture.Comments.Verify(x => x.AddAsync(It.IsAny<Comment>(), It.IsAny<CancellationToken>()), Times.Once);
        fixture.UnitOfWork.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Once);
        // Notification to every participant except the author (owner + 1 other = 2).
        fixture.Outbox.Verify(x => x.AddAsync(It.IsAny<OutboxMessage>(), It.IsAny<CancellationToken>()), Times.Exactly(2));
    }

    [Fact]
    [Trait("TestType", "Security")]
    public async Task AddComment_WithoutAccess_ThrowsForbidden()
    {
        var fixture = new Fixture();
        fixture.DenyAccess();

        await Assert.ThrowsAsync<ForbiddenException>(() =>
            fixture.AddHandler().Handle(new AddCommentCommand(fixture.TaskId, "x"), CancellationToken.None));

        fixture.Comments.Verify(x => x.AddAsync(It.IsAny<Comment>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    [Trait("TestType", "Security")]
    public async Task AddComment_OnMissingTask_ThrowsNotFound()
    {
        var fixture = new Fixture();
        fixture.TaskDoesNotExist();

        await Assert.ThrowsAsync<EntityNotFoundException>(() =>
            fixture.AddHandler().Handle(new AddCommentCommand(fixture.TaskId, "x"), CancellationToken.None));
    }

    // ─── DeleteComment ──────────────────────────────────────────────────────────

    [Fact]
    [Trait("TestType", "Security")]
    public async Task DeleteComment_SystemComment_ThrowsForbidden()
    {
        var fixture = new Fixture();
        var system = Comment.CreateSystem(fixture.TaskId, "X created the task");
        fixture.Comments.Setup(x => x.GetByIdAsync(system.Id, It.IsAny<CancellationToken>())).ReturnsAsync(system);

        await Assert.ThrowsAsync<ForbiddenException>(() =>
            fixture.DeleteHandler().Handle(new DeleteCommentCommand(fixture.TaskId, system.Id), CancellationToken.None));
    }

    [Fact]
    [Trait("TestType", "Functional")]
    public async Task DeleteComment_ByAuthor_SoftDeletes()
    {
        var fixture = new Fixture();
        var comment = Comment.Create(fixture.TaskId, fixture.UserId, "Me", "mine");
        fixture.Comments.Setup(x => x.GetByIdAsync(comment.Id, It.IsAny<CancellationToken>())).ReturnsAsync(comment);
        fixture.GrantAccess(owner: Guid.NewGuid());

        var result = await fixture.DeleteHandler().Handle(
            new DeleteCommentCommand(fixture.TaskId, comment.Id), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.True(comment.IsDeleted);
        fixture.Comments.Verify(x => x.Update(comment), Times.Once);
    }

    [Fact]
    [Trait("TestType", "Security")]
    public async Task DeleteComment_ByStranger_ThrowsForbidden()
    {
        var fixture = new Fixture();
        var comment = Comment.Create(fixture.TaskId, Guid.NewGuid(), "Other", "theirs");
        fixture.Comments.Setup(x => x.GetByIdAsync(comment.Id, It.IsAny<CancellationToken>())).ReturnsAsync(comment);
        fixture.GrantAccess(owner: Guid.NewGuid()); // viewer is neither author nor owner

        await Assert.ThrowsAsync<ForbiddenException>(() =>
            fixture.DeleteHandler().Handle(new DeleteCommentCommand(fixture.TaskId, comment.Id), CancellationToken.None));
    }

    // ─── UpdateComment ──────────────────────────────────────────────────────────

    [Fact]
    [Trait("TestType", "Functional")]
    public async Task UpdateComment_ByAuthor_Updates()
    {
        var fixture = new Fixture();
        var comment = Comment.Create(fixture.TaskId, fixture.UserId, "Me", "old");
        fixture.Comments.Setup(x => x.GetByIdAsync(comment.Id, It.IsAny<CancellationToken>())).ReturnsAsync(comment);
        fixture.Users
            .Setup(x => x.GetUserProfilesAsync(It.IsAny<IEnumerable<Guid>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new Dictionary<Guid, UserProfile>());

        var result = await fixture.UpdateHandler().Handle(
            new UpdateCommentCommand(fixture.TaskId, comment.Id, "new content"), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal("new content", comment.Content);
        fixture.Comments.Verify(x => x.Update(comment), Times.Once);
    }

    [Fact]
    [Trait("TestType", "Security")]
    public async Task UpdateComment_WrongTask_ThrowsNotFound()
    {
        var fixture = new Fixture();
        var comment = Comment.Create(Guid.NewGuid(), fixture.UserId, "Me", "old");
        fixture.Comments.Setup(x => x.GetByIdAsync(comment.Id, It.IsAny<CancellationToken>())).ReturnsAsync(comment);

        await Assert.ThrowsAsync<EntityNotFoundException>(() =>
            fixture.UpdateHandler().Handle(
                new UpdateCommentCommand(fixture.TaskId, comment.Id, "x"), CancellationToken.None));
    }

    // ─── Fixture ────────────────────────────────────────────────────────────────

    private sealed class Fixture
    {
        public Guid TaskId { get; } = Guid.NewGuid();
        public Guid UserId { get; } = Guid.NewGuid();
        public Mock<ICommentRepository> Comments { get; } = new();
        public Mock<IUnitOfWork> UnitOfWork { get; } = new();
        public Mock<ICurrentUserContext> CurrentUser { get; } = new();
        public Mock<ITaskAccessService> Access { get; } = new();
        public Mock<IOutboxRepository> Outbox { get; } = new();
        public Mock<IUserService> Users { get; } = new();

        public Fixture()
        {
            CurrentUser.SetupGet(x => x.UserId).Returns(UserId);
            CurrentUser.SetupGet(x => x.Name).Returns("Tester");
            CurrentUser.SetupGet(x => x.Email).Returns("tester@planora.dev");
            CurrentUser.SetupGet(x => x.ProfilePictureUrl).Returns((string?)null);
            UnitOfWork.Setup(x => x.SaveChangesAsync(It.IsAny<CancellationToken>())).ReturnsAsync(1);
            Comments.Setup(x => x.AddAsync(It.IsAny<Comment>(), It.IsAny<CancellationToken>()))
                .ReturnsAsync((Comment c, CancellationToken _) => c);
            Outbox.Setup(x => x.AddAsync(It.IsAny<OutboxMessage>(), It.IsAny<CancellationToken>()))
                .Returns(Task.CompletedTask);
        }

        public void GrantAccess(Guid owner, IReadOnlyList<Guid>? participants = null) =>
            Access.Setup(x => x.CheckCommentAccessAsync(TaskId, UserId, It.IsAny<CancellationToken>()))
                .ReturnsAsync(new TaskAccessResult(true, true, owner, participants ?? new[] { owner }, string.Empty, null));

        public void DenyAccess() =>
            Access.Setup(x => x.CheckCommentAccessAsync(TaskId, UserId, It.IsAny<CancellationToken>()))
                .ReturnsAsync(new TaskAccessResult(true, false, Guid.NewGuid(), Array.Empty<Guid>(), string.Empty, null));

        public void TaskDoesNotExist() =>
            Access.Setup(x => x.CheckCommentAccessAsync(TaskId, UserId, It.IsAny<CancellationToken>()))
                .ReturnsAsync(new TaskAccessResult(false, false, Guid.Empty, Array.Empty<Guid>(), string.Empty, null));

        public AddCommentCommandHandler AddHandler() =>
            new(Comments.Object, UnitOfWork.Object, CurrentUser.Object, Access.Object, Outbox.Object);

        public DeleteCommentCommandHandler DeleteHandler() =>
            new(Comments.Object, UnitOfWork.Object, CurrentUser.Object, Access.Object);

        public UpdateCommentCommandHandler UpdateHandler() =>
            new(Comments.Object, UnitOfWork.Object, CurrentUser.Object, Users.Object);
    }
}
