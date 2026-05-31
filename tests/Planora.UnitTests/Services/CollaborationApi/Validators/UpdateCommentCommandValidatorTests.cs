using Planora.Collaboration.Application.Features.Comments.Commands.UpdateComment;

namespace Planora.UnitTests.Services.CollaborationApi.Validators;

/// <summary>
/// The update validator enforces only the upper bound across both comment kinds (5000),
/// because it cannot tell a genesis comment from a regular one. The exact per-kind limit
/// (2000 regular / 5000 genesis) is enforced by the domain. This pins the regression where
/// the validator's blanket 2000 cap wrongly rejected valid 2001-5000 char genesis edits.
/// </summary>
public sealed class UpdateCommentCommandValidatorTests
{
    private static UpdateCommentCommand Command(string content) =>
        new(Guid.NewGuid(), Guid.NewGuid(), content);

    [Fact]
    [Trait("TestType", "Unit")]
    [Trait("TestType", "Regression")]
    public void Validate_ShouldAcceptGenesisLengthContentAbove2000()
    {
        var validator = new UpdateCommentCommandValidator();

        var result = validator.Validate(Command(new string('a', 3000)));

        Assert.True(result.IsValid);
    }

    [Fact]
    [Trait("TestType", "Unit")]
    [Trait("TestType", "Regression")]
    public void Validate_ShouldAcceptContentAtTheCeiling()
    {
        var validator = new UpdateCommentCommandValidator();

        var result = validator.Validate(Command(new string('a', 5000)));

        Assert.True(result.IsValid);
    }

    [Fact]
    [Trait("TestType", "Unit")]
    [Trait("TestType", "Regression")]
    public void Validate_ShouldRejectEmptyAndOverCeilingContent()
    {
        var validator = new UpdateCommentCommandValidator();

        var empty = validator.Validate(Command(string.Empty));
        var tooLong = validator.Validate(Command(new string('a', 5001)));
        var missingIds = validator.Validate(new UpdateCommentCommand(Guid.Empty, Guid.Empty, "ok"));

        Assert.Contains(empty.Errors, e => e.PropertyName == nameof(UpdateCommentCommand.Content));
        Assert.Contains(tooLong.Errors, e => e.ErrorMessage == "Content cannot exceed 5000 characters");
        Assert.Contains(missingIds.Errors, e => e.PropertyName == nameof(UpdateCommentCommand.TaskId));
        Assert.Contains(missingIds.Errors, e => e.PropertyName == nameof(UpdateCommentCommand.CommentId));
    }
}
