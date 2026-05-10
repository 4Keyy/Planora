using Planora.Auth.Application.Common.Options;
using Planora.Auth.Application.Features.Authentication.Commands.Login;
using Planora.Auth.Application.Features.Authentication.Commands.Register;
using Planora.Auth.Application.Features.Authentication.Commands.RequestPasswordReset;
using Planora.Auth.Application.Features.Authentication.Commands.RefreshToken;
using Planora.Auth.Application.Features.Authentication.Queries.ValidateToken;
using Planora.Auth.Application.Features.Authentication.Validators.Login;
using Planora.Auth.Application.Features.Authentication.Validators.Register;
using Planora.Auth.Application.Features.Authentication.Validators.RequestPasswordReset;
using Planora.Auth.Application.Features.Authentication.Validators.RefreshToken;
using Planora.Auth.Application.Features.Authentication.Validators.ValidateToken;

namespace Planora.UnitTests.Services.AuthApi.Authentication.Validators;

public class AuthValidatorTests
{
    [Fact]
    public void FrontendOptions_ShouldTrimTrailingSlashAndFallbackToLocalhost()
    {
        Assert.Equal(FrontendOptions.LocalFallbackBaseUrl, new FrontendOptions().GetNormalizedBaseUrl());
        Assert.Equal("https://app.example.com", new FrontendOptions
        {
            BaseUrl = " https://app.example.com/// "
        }.GetNormalizedBaseUrl());
    }

    [Fact]
    public void RegisterValidator_ShouldAcceptStrongValidRegistration()
    {
        var validator = new RegisterCommandValidator();

        var result = validator.Validate(new RegisterCommand
        {
            Email = "user@example.com",
            Password = "StrongPass123!",
            ConfirmPassword = "StrongPass123!",
            FirstName = "Ada",
            LastName = "Lovelace",
        });

        Assert.True(result.IsValid);
    }

    [Fact]
    public void RegisterValidator_ShouldRejectInvalidSecurityFields()
    {
        var validator = new RegisterCommandValidator();

        var result = validator.Validate(new RegisterCommand
        {
            Email = "not-email",
            Password = "weak",
            ConfirmPassword = "different",
            FirstName = "Ada1",
            LastName = "",
        });

        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, error => error.PropertyName == nameof(RegisterCommand.Email));
        Assert.Contains(result.Errors, error => error.PropertyName == nameof(RegisterCommand.Password));
        Assert.Contains(result.Errors, error => error.PropertyName == nameof(RegisterCommand.ConfirmPassword));
        Assert.Contains(result.Errors, error => error.PropertyName == nameof(RegisterCommand.FirstName));
        Assert.Contains(result.Errors, error => error.PropertyName == nameof(RegisterCommand.LastName));
    }

    [Theory]
    [InlineData("123456", true)]
    [InlineData("12345", false)]
    [InlineData("1234567", false)]
    [InlineData(null, true)]
    public void LoginValidator_ShouldValidateOptionalTwoFactorCode(string? code, bool expectedValid)
    {
        var validator = new LoginCommandValidator();

        var result = validator.Validate(new LoginCommand
        {
            Email = "user@example.com",
            Password = "password",
            TwoFactorCode = code,
        });

        Assert.Equal(expectedValid, result.IsValid);
    }

    [Fact]
    public void RequestPasswordResetValidator_ShouldRequireValidEmail()
    {
        var validator = new RequestPasswordResetCommandValidator();

        var invalid = validator.Validate(new RequestPasswordResetCommand { Email = "bad" });
        var valid = validator.Validate(new RequestPasswordResetCommand { Email = "user@example.com" });

        Assert.False(invalid.IsValid);
        Assert.True(valid.IsValid);
    }

    [Fact]
    public void ValidateTokenValidator_ShouldRequireToken()
    {
        var validator = new ValidateTokenQueryValidator();

        Assert.False(validator.Validate(new ValidateTokenQuery { Token = "" }).IsValid);
        Assert.True(validator.Validate(new ValidateTokenQuery { Token = "access-token" }).IsValid);
    }

    [Fact]
    public void RefreshTokenValidator_ShouldRequireRefreshToken()
    {
        var validator = new RefreshTokenCommandValidator();

        Assert.False(validator.Validate(new RefreshTokenCommand { RefreshToken = "" }).IsValid);
        Assert.True(validator.Validate(new RefreshTokenCommand { RefreshToken = "refresh-token" }).IsValid);
    }
}
