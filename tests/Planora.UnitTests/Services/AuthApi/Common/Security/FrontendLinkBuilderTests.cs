using Planora.Auth.Application.Common.Options;
using Planora.Auth.Application.Common.Security;

namespace Planora.UnitTests.Services.AuthApi.Common.Security;

public class FrontendLinkBuilderTests
{
    [Theory]
    [InlineData(null, "http://localhost:3000")]
    [InlineData("", "http://localhost:3000")]
    [InlineData("   ", "http://localhost:3000")]
    [InlineData("https://app.example.com/", "https://app.example.com")]
    [InlineData(" https://app.example.com/// ", "https://app.example.com")]
    public void GetNormalizedBaseUrl_ShouldFallbackTrimAndRemoveTrailingSlash(string? baseUrl, string expected)
    {
        var options = new FrontendOptions { BaseUrl = baseUrl };

        Assert.Equal(expected, options.GetNormalizedBaseUrl());
    }

    [Fact]
    public void PasswordReset_ShouldUseConfiguredFrontendUrl_AndEscapeOpaqueToken()
    {
        var options = new FrontendOptions { BaseUrl = "https://app.example.com/" };

        var link = FrontendLinkBuilder.PasswordReset(options, "token+/= with spaces");

        Assert.Equal("https://app.example.com/reset-password?token=token%2B%2F%3D%20with%20spaces", link);
    }

    [Fact]
    public void EmailVerification_ShouldUseConfiguredFrontendUrl_AndEscapeOpaqueToken()
    {
        var options = new FrontendOptions { BaseUrl = "https://app.example.com/" };

        var link = FrontendLinkBuilder.EmailVerification(options, "verify+/= token");

        Assert.Equal("https://app.example.com/auth/verify-email?token=verify%2B%2F%3D%20token", link);
    }
}
