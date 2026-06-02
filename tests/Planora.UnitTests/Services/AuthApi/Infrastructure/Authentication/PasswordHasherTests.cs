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

    [Fact]
    [Trait("TestType", "Security")]
    [Trait("TestType", "Regression")]
    public void VerifyPassword_AcceptsGoldenVector_LockingTheOnDiskFormat()
    {
        // PBKDF2-SHA512, 100_000 iterations, 16-byte salt + 32-byte hash, UTF-8 password,
        // base64(salt || hash). This vector was produced independently of HashPassword and
        // pins the exact stored format. It guards the .NET 9 -> 10 migration (Rfc2898DeriveBytes
        // ctor -> static Pbkdf2 is byte-identical) and any future drift in salt/hash size,
        // iteration count, or algorithm — a hash stored by an older build must still verify.
        var hasher = new PasswordHasher();
        const string goldenHash = "AQIDBAUGBwgJCgsMDQ4PEPXqZCX5InQz+aA/vDveKqFCThkoJGchmrM/xe9GgqqF";

        Assert.True(hasher.VerifyPassword("GoldenVector!23", goldenHash));
        Assert.False(hasher.VerifyPassword("wrong", goldenHash));
    }
}
