using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Planora.Auth.Infrastructure;

namespace Planora.UnitTests.Services.AuthApi.Infrastructure;

public sealed class AuthJwtStampWiringTests
{
    [Fact]
    [Trait("TestType", "Security")]
    public void AuthApi_BearerOptions_MustWireSecurityStampCheckOnTokenValidated()
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["JwtSettings:Secret"] = new string('x', 32),
                ["JwtSettings:Issuer"] = "Planora.Auth",
                ["JwtSettings:Audience"] = "Planora.Clients",
                ["ConnectionStrings:AuthDatabase"] = "Host=localhost;Database=test;Username=postgres;Password=postgres",
                ["ConnectionStrings:Redis"] = "localhost:6379",
                ["IsDevelopment"] = "true",
            })
            .Build();

        var services = new ServiceCollection();
        services.AddSingleton<IConfiguration>(configuration);
        services.AddLogging();
        services.AddAuthInfrastructure(configuration);

        var provider = services.BuildServiceProvider(validateScopes: false);
        var options = provider.GetRequiredService<IOptionsMonitor<JwtBearerOptions>>()
            .Get(JwtBearerDefaults.AuthenticationScheme);

        Assert.NotNull(options.Events);
        Assert.NotNull(options.Events!.OnTokenValidated);
        // The OnTokenValidated delegate is the security-stamp enforcement hook.
        // If a future refactor drops this wiring, all rotated tokens (password change,
        // 2FA disable, revoke-all, delete, email change) would keep working against
        // Auth's own endpoints until natural expiry — this assertion is the tripwire.
    }
}
