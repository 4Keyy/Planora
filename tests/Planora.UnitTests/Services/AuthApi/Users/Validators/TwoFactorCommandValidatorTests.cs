using Planora.Auth.Application.Features.Users.Commands.Confirm2FA;
using Planora.Auth.Application.Features.Users.Commands.Disable2FA;
using Planora.Auth.Application.Features.Users.Validators.Confirm2FA;
using Planora.Auth.Application.Features.Users.Validators.Disable2FA;

namespace Planora.UnitTests.Services.AuthApi.Users.Validators;

public sealed class TwoFactorCommandValidatorTests
{
    [Theory]
    [Trait("TestType", "Unit")]
    [Trait("TestType", "Security")]
    [Trait("TestType", "Regression")]
    [InlineData("123456", true)]
    [InlineData("", false)]
    [InlineData("12345", false)]
    [InlineData("1234567", false)]
    [InlineData("12A456", false)]
    public void Confirm2FAValidator_ShouldRequireSixDigits(string code, bool expectedValid)
    {
        var validator = new Confirm2FACommandValidator();

        var result = validator.Validate(new Confirm2FACommand { Code = code });

        Assert.Equal(expectedValid, result.IsValid);
    }

    [Fact]
    [Trait("TestType", "Unit")]
    [Trait("TestType", "Security")]
    [Trait("TestType", "Regression")]
    public void Disable2FAValidator_ShouldRequirePassword()
    {
        var validator = new Disable2FACommandValidator();

        Assert.True(validator.Validate(new Disable2FACommand { Password = "Password123!" }).IsValid);
        var invalid = validator.Validate(new Disable2FACommand());

        Assert.False(invalid.IsValid);
        Assert.Contains(invalid.Errors, error => error.ErrorMessage == "Password is required to disable 2FA");
    }
}
