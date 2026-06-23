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
    public void HashPassword_ShouldEmitVersionedFormat_With210kIterations()
    {
        var hasher = new PasswordHasher();

        var hash = hasher.HashPassword("SamePassword123!");

        // Self-describing PHC-style format: $pbkdf2-sha512$v=1$i=210000$<salt>$<key>
        Assert.StartsWith("$pbkdf2-sha512$v=1$i=210000$", hash, StringComparison.Ordinal);
        Assert.Equal(6, hash.Split('$').Length);
    }

    [Fact]
    public void HashPassword_ShouldUseUniqueSaltForSamePassword()
    {
        var hasher = new PasswordHasher();

        var first = hasher.HashPassword("SamePassword123!");
        var second = hasher.HashPassword("SamePassword123!");

        Assert.NotEqual(first, second);
        Assert.True(hasher.VerifyPassword("SamePassword123!", first));
        Assert.True(hasher.VerifyPassword("SamePassword123!", second));
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
    public void VerifyPassword_AcceptsLegacyVector_AndFlagsItForRehash()
    {
        // Pre-versioning format: PBKDF2-SHA512, 100_000 iterations, 16-byte salt + 32-byte hash,
        // UTF-8 password, base64(salt || hash). This vector was produced independently of
        // HashPassword and pins backward compatibility: a hash stored by an older build must
        // still verify, AND must be reported as needing an upgrade to the current work factor.
        var hasher = new PasswordHasher();
        const string legacyHash = "AQIDBAUGBwgJCgsMDQ4PEPXqZCX5InQz+aA/vDveKqFCThkoJGchmrM/xe9GgqqF";

        Assert.True(hasher.VerifyPassword("GoldenVector!23", legacyHash));
        Assert.False(hasher.VerifyPassword("wrong", legacyHash));
        Assert.True(hasher.NeedsRehash(legacyHash));
    }

    [Fact]
    [Trait("TestType", "Security")]
    public void NeedsRehash_ShouldFlagVersionedHashWithLowerIterationCount()
    {
        var hasher = new PasswordHasher();

        // A versioned hash produced with an older (lower) work factor must be flagged for rehash,
        // while still verifying correctly so the upgrade can happen on the next successful login.
        var salt = new byte[16];
        var key = System.Security.Cryptography.Rfc2898DeriveBytes.Pbkdf2(
            "Legacyish!23", salt, 100_000, System.Security.Cryptography.HashAlgorithmName.SHA512, 32);
        var olderVersioned =
            $"$pbkdf2-sha512$v=1$i=100000${Convert.ToBase64String(salt)}${Convert.ToBase64String(key)}";

        Assert.True(hasher.VerifyPassword("Legacyish!23", olderVersioned));
        Assert.True(hasher.NeedsRehash(olderVersioned));
    }
}
