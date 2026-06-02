using Planora.Collaboration.Application.Features.Comments.Commands.UpdateComment;

namespace Planora.UnitTests.Services.CollaborationApi.Validators;

/// <summary>
/// The update command edits only regular user comments (the task description is edited on the
/// task itself, not through this command), so the content limit is 2000 — matching AddComment
/// and the Comment.UpdateContent domain rule.
/// </summary>
public sealed class UpdateCommentCommandValidatorTests
{
    private static UpdateCommentCommand Command(string content) =>
        new(Guid.NewGuid(), Guid.NewGuid(), content);

    [Fact]
    [Trait("TestType", "Unit")]
    [Trait("TestType", "Regression")]
    public void Validate_ShouldAcceptContentAtTheLimit()
    {
        var validator = new UpdateCommentCommandValidator();

        var result = validator.Validate(Command(new string('a', 2000)));

        Assert.True(result.IsValid);
    }

    [Fact]
    [Trait("TestType", "Unit")]
    [Trait("TestType", "Regression")]
    public void Validate_ShouldRejectEmptyOverLimitAndMissingIds()
    {
        var validator = new UpdateCommentCommandValidator();

        var empty = validator.Validate(Command(string.Empty));
        var tooLong = validator.Validate(Command(new string('a', 2001)));
        var missingIds = validator.Validate(new UpdateCommentCommand(Guid.Empty, Guid.Empty, "ok"));

        Assert.Contains(empty.Errors, e => e.PropertyName == nameof(UpdateCommentCommand.Content));
        Assert.Contains(tooLong.Errors, e => e.ErrorMessage == "Content cannot exceed 2000 characters");
        Assert.Contains(missingIds.Errors, e => e.PropertyName == nameof(UpdateCommentCommand.TaskId));
        Assert.Contains(missingIds.Errors, e => e.PropertyName == nameof(UpdateCommentCommand.CommentId));
    }
}
