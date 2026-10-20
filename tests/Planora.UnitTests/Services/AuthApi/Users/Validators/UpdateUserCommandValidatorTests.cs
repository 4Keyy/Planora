using Planora.Auth.Application.Common.Interfaces;
using Planora.Auth.Application.Features.Users.Commands.UpdateUser;
using Planora.Auth.Application.Features.Users.Validators.UpdateUser;

namespace Planora.UnitTests.Services.AuthApi.Users.Validators;

public sealed class UpdateUserCommandValidatorTests
{
    private const string AvatarPrefix = "/avatars/0123456789abcdef0123456789abcdef/deadbeefcafebabe/";

    [Theory]
    [Trait("TestType", "Unit")]
    [Trait("TestType", "Regression")]
    [InlineData(AvatarSize.Small)]
    [InlineData(AvatarSize.Medium)]
    [InlineData(AvatarSize.Large)]
    public void ProfilePictureUrl_ShouldAcceptCanonicalAvatarVariants(AvatarSize size)
    {
        var result = Validate(AvatarPrefix + (int)size + ".webp");

        Assert.True(result.IsValid);
    }

    [Theory]
    [Trait("TestType", "Unit")]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("http://example.com/avatar.png")]
    [InlineData("https://example.com/avatar.png")]
    public void ProfilePictureUrl_ShouldPreserveRemovalAndAbsoluteHttpUrls(string? url)
    {
        Assert.True(Validate(url).IsValid);
    }

    [Theory]
    [Trait("TestType", "Unit")]
    [Trait("TestType", "Security")]
    [InlineData("//example.com" + AvatarPrefix + "128.webp")]
    [InlineData("/avatars/../x")]
    [InlineData("javascript:alert(1)")]
    [InlineData("data:image/png;base64,aGVsbG8=")]
    [InlineData("file:///avatars/avatar.webp")]
    [InlineData("ftp://example.com/avatar.png")]
    [InlineData(@"\avatars\0123456789abcdef0123456789abcdef\deadbeefcafebabe\128.webp")]
    [InlineData(AvatarPrefix + @"..\128.webp")]
    [InlineData(AvatarPrefix + "128.webp?version=1")]
    [InlineData(AvatarPrefix + "128.webp#avatar")]
    [InlineData("/images/avatar.webp")]
    [InlineData("avatars/0123456789abcdef0123456789abcdef/deadbeefcafebabe/128.webp")]
    [InlineData("/prefix" + AvatarPrefix + "128.webp")]
    [InlineData(AvatarPrefix + "128.webp/extra")]
    [InlineData(AvatarPrefix + "128.webp\n")]
    [InlineData(AvatarPrefix + "128.webp\r\n")]
    [InlineData(" " + AvatarPrefix + "128.webp")]
    [InlineData(AvatarPrefix + "128.webp ")]
    [InlineData("/avatars/01234567-89ab-cdef-0123-456789abcdef/deadbeefcafebabe/128.webp")]
    [InlineData("/avatars/0123456789ABCDEF0123456789ABCDEF/deadbeefcafebabe/128.webp")]
    [InlineData("/avatars/0123456789abcdef0123456789abcde/deadbeefcafebabe/128.webp")]
    [InlineData("/avatars/0123456789abcdef0123456789abcdefg/deadbeefcafebabe/128.webp")]
    [InlineData("/avatars/0123456789abcdef0123456789abcdef/deadbeefcafebab/128.webp")]
    [InlineData("/avatars/0123456789abcdef0123456789abcdef/deadbeefcafebabe0/128.webp")]
    [InlineData("/avatars/0123456789abcdef0123456789abcdef/DEADBEEFCAFEBABE/128.webp")]
    [InlineData("/avatars/0123456789abcdef0123456789abcdef/deadbeefcafebabg/128.webp")]
    [InlineData("/avatars/0123456789abcdef0123456789abcdef/%2e%2e/128.webp")]
    [InlineData(AvatarPrefix + "256.webp")]
    [InlineData(AvatarPrefix + "0128.webp")]
    [InlineData(AvatarPrefix + "128.png")]
    [InlineData(AvatarPrefix + "128.WEBP")]
    [InlineData(" ")]
    public void ProfilePictureUrl_ShouldRejectNonCanonicalPathsAndUnsupportedSchemes(string url)
    {
        var result = Validate(url);

        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, error => error.PropertyName == nameof(UpdateUserCommand.ProfilePictureUrl));
    }

    private static FluentValidation.Results.ValidationResult Validate(string? url) =>
        new UpdateUserCommandValidator().Validate(new UpdateUserCommand
        {
            FirstName = "Ada",
            LastName = "Lovelace",
            ProfilePictureUrl = url
        });
}
