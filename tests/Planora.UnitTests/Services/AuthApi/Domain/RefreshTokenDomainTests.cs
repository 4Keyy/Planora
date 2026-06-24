using Planora.Auth.Domain.Entities;
using Planora.Auth.Domain.Exceptions;

namespace Planora.UnitTests.Services.AuthApi.Domain;

public class RefreshTokenDomainTests
{
    private static RefreshToken CreateToken() =>
        new(Guid.NewGuid(), "raw-token", "127.0.0.1", DateTime.UtcNow.AddDays(7), rememberMe: false,
            deviceFingerprint: "fp", deviceName: "Chrome");

    [Fact]
    [Trait("TestType", "Security")]
    [Trait("TestType", "Regression")]
    public void UpdateForReLogin_ShouldRefuseToRevive_RevokedToken()
    {
        var token = CreateToken();
        token.Revoke("10.0.0.9", "User logout");

        // A revoked session must never be silently re-activated by a re-login — that would erase the
        // revocation audit and resurrect a killed token. The domain rejects it; the caller mints new.
        var ex = Assert.Throws<AuthDomainException>(() =>
            token.UpdateForReLogin("new-token", DateTime.UtcNow.AddDays(7), rememberMe: true, "10.0.0.9"));

        Assert.Contains("revoked", ex.Message, StringComparison.OrdinalIgnoreCase);
        // Revocation audit is preserved intact.
        Assert.True(token.IsRevoked);
        Assert.Equal("User logout", token.RevokedReason);
        Assert.Equal("10.0.0.9", token.RevokedByIp);
        Assert.False(token.Matches("new-token"));
    }

    [Fact]
    [Trait("TestType", "Regression")]
    public void UpdateForReLogin_ShouldRotateValues_OnActiveToken()
    {
        var token = CreateToken();
        var newExpiry = DateTime.UtcNow.AddDays(30);

        token.UpdateForReLogin("rotated-token", newExpiry, rememberMe: true, "10.0.0.1");

        Assert.True(token.Matches("rotated-token"));
        Assert.True(token.RememberMe);
        Assert.Equal("10.0.0.1", token.CreatedByIp);
        Assert.Equal(2, token.LoginCount);
        Assert.False(token.IsRevoked);
    }
}
