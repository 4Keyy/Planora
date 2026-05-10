using Planora.Auth.Application.Features.Authentication.Commands.Logout;
using Planora.Auth.Application.Features.Authentication.Validators.Logout;

namespace Planora.UnitTests.Services.AuthApi.Authentication.Validators;

public sealed class LogoutCommandValidatorTests
{
    [Fact]
    [Trait("TestType", "Unit")]
    [Trait("TestType", "Security")]
    [Trait("TestType", "Regression")]
    public void Validate_ShouldAllowMissingRefreshTokenAndLongRefreshToken()
    {
        var validator = new LogoutCommandValidator();

        var missing = validator.Validate(new LogoutCommand());
        var longToken = validator.Validate(new LogoutCommand
        {
            RefreshToken = new string('a', 20)
        });

        Assert.True(missing.IsValid);
        Assert.True(longToken.IsValid);
    }

    [Fact]
    [Trait("TestType", "Unit")]
    [Trait("TestType", "Security")]
    [Trait("TestType", "Regression")]
    public void Validate_ShouldRejectShortRefreshTokenWhenProvided()
    {
        var validator = new LogoutCommandValidator();

        var result = validator.Validate(new LogoutCommand
        {
            RefreshToken = "short"
        });

        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, error => error.ErrorMessage == "Invalid refresh token format");
    }
}
