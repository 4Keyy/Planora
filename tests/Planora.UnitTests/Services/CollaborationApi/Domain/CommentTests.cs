using Planora.BuildingBlocks.Domain.Exceptions;
using Planora.Collaboration.Domain.Entities;
using Planora.Collaboration.Domain.Events;

namespace Planora.UnitTests.Services.CollaborationApi.Domain;

public class CommentTests
{
    private static readonly Guid _taskId = Guid.NewGuid();
    private static readonly Guid _authorId = Guid.NewGuid();

    // ─── Create ───────────────────────────────────────────────────────────────

    [Fact]
    public void Create_ShouldProduceValidComment()
    {
        var comment = Comment.Create(_taskId, _authorId, "Alice", "Hello world");

        Assert.NotEqual(Guid.Empty, comment.Id);
        Assert.Equal(_taskId, comment.TaskId);
        Assert.Equal(_authorId, comment.AuthorId);
        Assert.Equal("Alice", comment.AuthorName);
        Assert.Equal("Hello world", comment.Content);
        Assert.NotEqual(default, comment.CreatedAt);
        Assert.Null(comment.UpdatedAt);
        Assert.False(comment.IsEdited);
        Assert.False(comment.IsSystemComment);
        Assert.False(comment.IsGenesisComment);
        Assert.Contains(comment.DomainEvents,
            e => e is CommentAddedDomainEvent ev && ev.CommentId == comment.Id && ev.TaskId == _taskId);
    }

    [Fact]
    public void Create_ShouldTrimWhitespace()
    {
        var comment = Comment.Create(_taskId, _authorId, "  Bob  ", "  Hi  ");

        Assert.Equal("Bob", comment.AuthorName);
        Assert.Equal("Hi", comment.Content);
    }

    [Fact]
    public void Create_WithEmptyContent_ShouldThrow()
    {
        Assert.Throws<InvalidValueObjectException>(() =>
            Comment.Create(_taskId, _authorId, "Author", ""));
        Assert.Throws<InvalidValueObjectException>(() =>
            Comment.Create(_taskId, _authorId, "Author", "   "));
    }

    [Fact]
    public void Create_WithContentOver2000Chars_ShouldThrow()
    {
        var longContent = new string('x', 2001);
        Assert.Throws<InvalidValueObjectException>(() =>
            Comment.Create(_taskId, _authorId, "Author", longContent));
    }

    [Fact]
    public void Create_WithExactly2000Chars_ShouldSucceed()
    {
        var maxContent = new string('x', 2000);
        var comment = Comment.Create(_taskId, _authorId, "Author", maxContent);
        Assert.Equal(2000, comment.Content.Length);
    }

    [Fact]
    public void Create_WithEmptyAuthorName_ShouldThrow()
    {
        Assert.Throws<InvalidValueObjectException>(() =>
            Comment.Create(_taskId, _authorId, " ", "Valid content"));
    }

    [Fact]
    public void Create_WithEmptyTaskId_ShouldThrow()
    {
        Assert.Throws<InvalidValueObjectException>(() =>
            Comment.Create(Guid.Empty, _authorId, "Author", "Content"));
    }

    [Fact]
    public void Create_WithEmptyAuthorId_ShouldThrow()
    {
        Assert.Throws<InvalidValueObjectException>(() =>
            Comment.Create(_taskId, Guid.Empty, "Author", "Content"));
    }

    // ─── System / Genesis ───────────────────────────────────────────────────────

    [Fact]
    public void CreateSystem_ShouldMarkSystemAndRaiseNoDomainEvent()
    {
        var comment = Comment.CreateSystem(_taskId, "Alice created the task");

        Assert.True(comment.IsSystemComment);
        Assert.False(comment.IsGenesisComment);
        Assert.Equal(Guid.Empty, comment.AuthorId);
        Assert.Empty(comment.DomainEvents);
    }

    // Note: the genesis comment (task description) is no longer a stored Comment — it is the
    // single-source-of-truth TodoItem.Description, synthesised into the timeline on read. The
    // former CreateGenesis / UpdateGenesisContent domain methods were removed with that change.

    // ─── UpdateContent ────────────────────────────────────────────────────────

    [Fact]
    public void UpdateContent_ByAuthor_ShouldUpdateAndMarkModified()
    {
        var comment = Comment.Create(_taskId, _authorId, "Alice", "Original");

        comment.UpdateContent("Updated content", _authorId);

        Assert.Equal("Updated content", comment.Content);
        Assert.NotNull(comment.UpdatedAt);
        Assert.Equal(_authorId, comment.UpdatedBy);
    }

    [Fact]
    public void UpdateContent_ByNonAuthor_ShouldThrowForbidden()
    {
        var comment = Comment.Create(_taskId, _authorId, "Alice", "Original");

        Assert.Throws<ForbiddenException>(() =>
            comment.UpdateContent("Hacked content", Guid.NewGuid()));
    }

    [Fact]
    public void UpdateContent_WithContentOver2000Chars_ShouldThrow()
    {
        var comment = Comment.Create(_taskId, _authorId, "Alice", "Original");
        var longContent = new string('x', 2001);

        Assert.Throws<InvalidValueObjectException>(() =>
            comment.UpdateContent(longContent, _authorId));
    }

    // ─── SoftDelete ───────────────────────────────────────────────────────────

    [Fact]
    public void MarkAsDeleted_ShouldSetIsDeletedAndTimestamp()
    {
        var comment = Comment.Create(_taskId, _authorId, "Alice", "Hello");
        var deleterId = Guid.NewGuid();

        comment.MarkAsDeleted(deleterId);

        Assert.True(comment.IsDeleted);
        Assert.NotNull(comment.DeletedAt);
        Assert.Equal(deleterId, comment.DeletedBy);
    }
}
