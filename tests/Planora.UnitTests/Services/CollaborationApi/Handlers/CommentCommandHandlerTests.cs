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

    // ─── AddComment: replies ────────────────────────────────────────────────────

    [Fact]
    [Trait("TestType", "Functional")]
    public async Task AddComment_ReplyToComment_SnapshotsTargetAndNotifiesQuotedAuthor()
    {
        var fixture = new Fixture();
        var owner = Guid.NewGuid();
        var quotedAuthor = Guid.NewGuid();
        fixture.GrantAccess(owner, participants: new[] { owner, fixture.UserId, quotedAuthor });

        var target = Comment.Create(fixture.TaskId, quotedAuthor, "Anna M", "Original message text");
        fixture.Comments.Setup(x => x.GetByIdAsync(target.Id, It.IsAny<CancellationToken>())).ReturnsAsync(target);

        var result = await fixture.AddHandler().Handle(
            new AddCommentCommand(fixture.TaskId, "Agreed!", "comment", target.Id), CancellationToken.None);

        Assert.True(result.IsSuccess);
        var dto = result.Value!;
        Assert.Equal("comment", dto.ReplyToType);
        Assert.Equal(target.Id, dto.ReplyToId);
        Assert.Equal(quotedAuthor, dto.ReplyToAuthorId);
        Assert.Equal("Anna M", dto.ReplyToAuthorName);
        Assert.Equal("Original message text", dto.ReplyToPreview);
        Assert.False(dto.ReplyToDeleted);

        // Quoted author gets the dedicated reply notification; the other participant the generic one.
        Assert.Equal(2, fixture.OutboxMessages.Count);
        Assert.Single(fixture.OutboxMessages, m => m.Content.Contains("ReplyAdded"));
        Assert.Single(fixture.OutboxMessages, m => m.Content.Contains("CommentAdded"));
    }

    [Fact]
    [Trait("TestType", "Functional")]
    public async Task AddComment_ReplyToReply_IsAllowed_QuotesTheReplyItself()
    {
        var fixture = new Fixture();
        fixture.GrantAccess(owner: Guid.NewGuid());

        var firstAuthor = Guid.NewGuid();
        var existingReply = Comment.CreateReply(
            fixture.TaskId, firstAuthor, "First", "I answered already",
            Planora.Collaboration.Domain.Enums.ReplyTargetType.Comment,
            Guid.NewGuid(), Guid.NewGuid(), "Root", "root text");
        fixture.Comments.Setup(x => x.GetByIdAsync(existingReply.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(existingReply);

        var result = await fixture.AddHandler().Handle(
            new AddCommentCommand(fixture.TaskId, "Chain it", "comment", existingReply.Id), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(existingReply.Id, result.Value!.ReplyToId);
        Assert.Equal("I answered already", result.Value.ReplyToPreview);
    }

    [Fact]
    [Trait("TestType", "Security")]
    public async Task AddComment_ReplyToCommentFromAnotherTask_ThrowsNotFound()
    {
        var fixture = new Fixture();
        fixture.GrantAccess(owner: Guid.NewGuid());

        var foreign = Comment.Create(Guid.NewGuid(), Guid.NewGuid(), "Other", "other branch");
        fixture.Comments.Setup(x => x.GetByIdAsync(foreign.Id, It.IsAny<CancellationToken>())).ReturnsAsync(foreign);

        await Assert.ThrowsAsync<EntityNotFoundException>(() =>
            fixture.AddHandler().Handle(
                new AddCommentCommand(fixture.TaskId, "x", "comment", foreign.Id), CancellationToken.None));

        fixture.Comments.Verify(x => x.AddAsync(It.IsAny<Comment>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    [Trait("TestType", "Security")]
    public async Task AddComment_ReplyToSystemComment_IsRejected()
    {
        var fixture = new Fixture();
        fixture.GrantAccess(owner: Guid.NewGuid());

        var system = Comment.CreateSystem(fixture.TaskId, "X completed the task");
        fixture.Comments.Setup(x => x.GetByIdAsync(system.Id, It.IsAny<CancellationToken>())).ReturnsAsync(system);

        await Assert.ThrowsAsync<InvalidValueObjectException>(() =>
            fixture.AddHandler().Handle(
                new AddCommentCommand(fixture.TaskId, "x", "comment", system.Id), CancellationToken.None));
    }

    [Fact]
    [Trait("TestType", "Functional")]
    public async Task AddComment_ReplyToSubtask_ValidatesViaTodoAndSnapshotsTitle()
    {
        var fixture = new Fixture();
        var subtaskId = Guid.NewGuid();
        var subtaskAuthor = Guid.NewGuid();
        fixture.GrantAccess(owner: subtaskAuthor, participants: new[] { subtaskAuthor, fixture.UserId });
        fixture.Access.Setup(x => x.GetSubtaskBriefAsync(fixture.TaskId, subtaskId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new SubtaskBrief(true, "Collect the hiring numbers", subtaskAuthor));

        var result = await fixture.AddHandler().Handle(
            new AddCommentCommand(fixture.TaskId, "On it", "subtask", subtaskId), CancellationToken.None);

        Assert.True(result.IsSuccess);
        var dto = result.Value!;
        Assert.Equal("subtask", dto.ReplyToType);
        Assert.Equal(subtaskId, dto.ReplyToId);
        Assert.Equal(subtaskAuthor, dto.ReplyToAuthorId);
        Assert.Equal("Collect the hiring numbers", dto.ReplyToPreview);
        Assert.Single(fixture.OutboxMessages, m => m.Content.Contains("ReplyAdded"));
    }

    [Fact]
    [Trait("TestType", "Security")]
    public async Task AddComment_ReplyToMissingSubtask_ThrowsNotFound()
    {
        var fixture = new Fixture();
        var subtaskId = Guid.NewGuid();
        fixture.GrantAccess(owner: Guid.NewGuid());
        fixture.Access.Setup(x => x.GetSubtaskBriefAsync(fixture.TaskId, subtaskId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new SubtaskBrief(false, string.Empty, Guid.Empty));

        await Assert.ThrowsAsync<EntityNotFoundException>(() =>
            fixture.AddHandler().Handle(
                new AddCommentCommand(fixture.TaskId, "x", "subtask", subtaskId), CancellationToken.None));
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
        fixture.GrantAccess(fixture.UserId);
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
    public async Task UpdateComment_AuthorWithoutTaskAccess_ThrowsForbidden()
    {
        var fixture = new Fixture();
        fixture.DenyAccess();
        var comment = Comment.Create(fixture.TaskId, fixture.UserId, "Me", "old");
        fixture.Comments.Setup(x => x.GetByIdAsync(comment.Id, It.IsAny<CancellationToken>())).ReturnsAsync(comment);

        await Assert.ThrowsAsync<ForbiddenException>(() =>
            fixture.UpdateHandler().Handle(
                new UpdateCommentCommand(fixture.TaskId, comment.Id, "x"), CancellationToken.None));

        fixture.Comments.Verify(x => x.Update(It.IsAny<Comment>()), Times.Never);
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

        public List<OutboxMessage> OutboxMessages { get; } = new();

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
                .Callback<OutboxMessage, CancellationToken>((m, _) => OutboxMessages.Add(m))
                .Returns(Task.CompletedTask);
            // Live profile resolution defaults to "unknown" — handlers must fall back gracefully.
            Users.Setup(x => x.GetUserProfilesAsync(It.IsAny<IEnumerable<Guid>>(), It.IsAny<CancellationToken>()))
                .ReturnsAsync(new Dictionary<Guid, UserProfile>());
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
            new(Comments.Object, UnitOfWork.Object, CurrentUser.Object, Access.Object, Outbox.Object, Users.Object);

        public DeleteCommentCommandHandler DeleteHandler() =>
            new(Comments.Object, UnitOfWork.Object, CurrentUser.Object, Access.Object);

        public UpdateCommentCommandHandler UpdateHandler() =>
            new(Comments.Object, UnitOfWork.Object, CurrentUser.Object, Users.Object, Access.Object);
    }
}
