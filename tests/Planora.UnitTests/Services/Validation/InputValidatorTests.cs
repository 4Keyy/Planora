using Planora.Auth.Application.Features.Users.Commands.ChangePassword;
using Planora.Auth.Application.Features.Users.Validators.ChangePassword;
using Planora.Messaging.Application.Features.Messages.Commands.SendMessage;

namespace Planora.UnitTests.Services.Validation;

public sealed class InputValidatorTests
{
    [Fact]
    [Trait("TestType", "Unit")]
    [Trait("TestType", "Security")]
    [Trait("TestType", "Regression")]
    public void ChangePasswordCommandValidator_ShouldAcceptStrongChangedPassword()
    {
        var validator = new ChangePasswordCommandValidator();

        var result = validator.Validate(new ChangePasswordCommand
        {
            CurrentPassword = "OldPassword123!",
            NewPassword = "NewPassword123!",
            ConfirmNewPassword = "NewPassword123!"
        });

        Assert.True(result.IsValid);
    }

    [Fact]
    [Trait("TestType", "Unit")]
    [Trait("TestType", "Security")]
    [Trait("TestType", "Regression")]
    public void ChangePasswordCommandValidator_ShouldRejectMissingWeakSameTooLongOrMismatchedPasswords()
    {
        var validator = new ChangePasswordCommandValidator();
        var tooLong = $"{new string('A', 129)}a1!";

        var missing = validator.Validate(new ChangePasswordCommand());
        var weak = validator.Validate(new ChangePasswordCommand
        {
            CurrentPassword = "OldPassword123!",
            NewPassword = "weak",
            ConfirmNewPassword = "weak"
        });
        var same = validator.Validate(new ChangePasswordCommand
        {
            CurrentPassword = "SamePassword123!",
            NewPassword = "SamePassword123!",
            ConfirmNewPassword = "SamePassword123!"
        });
        var longAndMismatched = validator.Validate(new ChangePasswordCommand
        {
            CurrentPassword = "OldPassword123!",
            NewPassword = tooLong,
            ConfirmNewPassword = "DifferentPassword123!"
        });

        Assert.Contains(missing.Errors, error => error.PropertyName == nameof(ChangePasswordCommand.CurrentPassword));
        Assert.Contains(missing.Errors, error => error.PropertyName == nameof(ChangePasswordCommand.NewPassword));
        Assert.Contains(missing.Errors, error => error.PropertyName == nameof(ChangePasswordCommand.ConfirmNewPassword));
        Assert.Contains(weak.Errors, error => error.PropertyName == nameof(ChangePasswordCommand.NewPassword));
        Assert.Contains(same.Errors, error => error.ErrorMessage == "New password must be different from current password");
        Assert.Contains(longAndMismatched.Errors, error => error.ErrorMessage == "Password cannot exceed 128 characters");
        Assert.Contains(longAndMismatched.Errors, error => error.ErrorMessage == "Passwords do not match");
    }

    [Fact]
    [Trait("TestType", "Unit")]
    [Trait("TestType", "Security")]
    [Trait("TestType", "Regression")]
    public void SendMessageCommandValidator_ShouldAcceptValidMessage()
    {
        var validator = new SendMessageCommandValidator();

        var result = validator.Validate(new SendMessageCommand(
            SenderId: Guid.NewGuid(),
            Subject: "Hello",
            Body: "Message body",
            RecipientId: Guid.NewGuid()));

        Assert.True(result.IsValid);
    }

    [Fact]
    [Trait("TestType", "Unit")]
    [Trait("TestType", "Security")]
    [Trait("TestType", "Regression")]
    public void SendMessageCommandValidator_ShouldRejectMissingTooLongAndSelfAddressedMessages()
    {
        var validator = new SendMessageCommandValidator();
        var sameUserId = Guid.NewGuid();

        var missing = validator.Validate(new SendMessageCommand(
            SenderId: null,
            Subject: "",
            Body: "",
            RecipientId: Guid.Empty));
        var tooLong = validator.Validate(new SendMessageCommand(
            SenderId: Guid.NewGuid(),
            Subject: new string('s', 201),
            Body: new string('b', 10001),
            RecipientId: Guid.NewGuid()));
        var selfAddressed = validator.Validate(new SendMessageCommand(
            SenderId: sameUserId,
            Subject: "Hello",
            Body: "Body",
            RecipientId: sameUserId));

        Assert.Contains(missing.Errors, error => error.PropertyName == nameof(SendMessageCommand.RecipientId));
        Assert.Contains(missing.Errors, error => error.PropertyName == nameof(SendMessageCommand.Subject));
        Assert.Contains(missing.Errors, error => error.PropertyName == nameof(SendMessageCommand.Body));
        Assert.Contains(tooLong.Errors, error => error.ErrorMessage == "Subject must not exceed 200 characters.");
        Assert.Contains(tooLong.Errors, error => error.ErrorMessage == "Body must not exceed 10000 characters.");
        Assert.Contains(selfAddressed.Errors, error => error.ErrorMessage == "Cannot send message to yourself");
    }
}
