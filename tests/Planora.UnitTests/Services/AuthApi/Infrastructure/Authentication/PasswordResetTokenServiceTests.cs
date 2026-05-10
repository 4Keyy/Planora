using Planora.Auth.Application.Common.Security;
using Planora.Auth.Infrastructure.Services.Authentication;
using Microsoft.Extensions.Configuration;

namespace Planora.UnitTests.Services.AuthApi.Infrastructure.Authentication;

public sealed class PasswordResetTokenServiceTests
{
    [Fact]
    [Trait("TestType", "Security")]
    [Trait("TestType", "Regression")]
    public void PasswordResetTokenService_ShouldUseConfiguredLifetimeAndOpaqueTokenHashing()
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["PasswordReset:TokenLifetimeMinutes"] = "45"
            })
            .Build();
        var service = new PasswordResetTokenService(configuration);
        const string token = " reset-token ";
        var hash = OpaqueToken.Hash(token);

        Assert.Equal(TimeSpan.FromMinutes(45), service.TokenLifetime);
        Assert.Equal(hash, service.HashToken(token));
        Assert.True(service.IsTokenValid(token, hash, DateTime.UtcNow.AddMinutes(1)));
        Assert.False(service.IsTokenValid(token, hash, DateTime.UtcNow.AddSeconds(-1)));
    }
}
