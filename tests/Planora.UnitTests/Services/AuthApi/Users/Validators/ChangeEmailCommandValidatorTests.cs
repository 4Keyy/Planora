using Planora.Auth.Application.Features.Users.Commands.ChangeEmail;
using Planora.Auth.Application.Features.Users.Validators.ChangeEmail;

namespace Planora.UnitTests.Services.AuthApi.Users.Validators;

public sealed class ChangeEmailCommandValidatorTests
{
    [Fact]
    [Trait("TestType", "Unit")]
    [Trait("TestType", "Security")]
    [Trait("TestType", "Regression")]
    public void Validate_ShouldAcceptValidEmailAndPassword()
    {
        var validator = new ChangeEmailCommandValidator();

        var result = validator.Validate(new ChangeEmailCommand
        {
            NewEmail = "new@example.com",
            Password = "Password123!"
        });

        Assert.True(result.IsValid);
    }

    [Fact]
    [Trait("TestType", "Unit")]
    [Trait("TestType", "Security")]
    [Trait("TestType", "Regression")]
    public void Validate_ShouldRejectMissingInvalidTooLongEmailAndMissingPassword()
    {
        var validator = new ChangeEmailCommandValidator();

        var missing = validator.Validate(new ChangeEmailCommand());
        var invalid = validator.Validate(new ChangeEmailCommand
        {
            NewEmail = "not-an-email",
            Password = "Password123!"
        });
        var tooLong = validator.Validate(new ChangeEmailCommand
        {
            NewEmail = $"{new string('a', 246)}@example.com",
            Password = "Password123!"
        });

        Assert.Contains(missing.Errors, error => error.PropertyName == nameof(ChangeEmailCommand.NewEmail));
        Assert.Contains(missing.Errors, error => error.PropertyName == nameof(ChangeEmailCommand.Password));
        Assert.Contains(invalid.Errors, error => error.ErrorMessage == "Invalid email format");
        Assert.Contains(tooLong.Errors, error => error.ErrorMessage == "Email cannot exceed 255 characters");
    }
}
