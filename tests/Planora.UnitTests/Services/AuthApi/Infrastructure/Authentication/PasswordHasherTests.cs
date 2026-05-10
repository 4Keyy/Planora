using Planora.Auth.Infrastructure.Services.Authentication;

namespace Planora.UnitTests.Services.AuthApi.Infrastructure.Authentication;

public class PasswordHasherTests
{
    [Fact]
    public void HashPassword_ShouldVerifyOriginalPassword_AndRejectWrongPassword()
    {
        var hasher = new PasswordHasher();

        var hash = hasher.HashPassword("CorrectHorseBatteryStaple123!");

        Assert.True(hasher.VerifyPassword("CorrectHorseBatteryStaple123!", hash));
        Assert.False(hasher.VerifyPassword("wrong-password", hash));
        Assert.False(hasher.NeedsRehash(hash));
    }

    [Fact]
    public void HashPassword_ShouldUseUniqueSaltForSamePassword()
    {
        var hasher = new PasswordHasher();

        var first = hasher.HashPassword("SamePassword123!");
        var second = hasher.HashPassword("SamePassword123!");

        Assert.NotEqual(first, second);
        Assert.Equal(48, Convert.FromBase64String(first).Length);
        Assert.Equal(48, Convert.FromBase64String(second).Length);
    }

    [Theory]
    [InlineData("")]
    [InlineData("not-base64")]
    public void VerifyPassword_ShouldRejectMalformedHashes(string hash)
    {
        var hasher = new PasswordHasher();

        Assert.ThrowsAny<Exception>(() => hasher.VerifyPassword("password", hash));
    }
}
