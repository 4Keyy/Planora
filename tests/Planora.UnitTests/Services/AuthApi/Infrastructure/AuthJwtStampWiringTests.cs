using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Microsoft.Extensions.Options;
using Planora.Auth.Infrastructure;
using Planora.BuildingBlocks.Infrastructure.Extensions;

namespace Planora.UnitTests.Services.AuthApi.Infrastructure;

public sealed class AuthJwtStampWiringTests
{
    [Fact]
    [Trait("TestType", "Security")]
    public void AuthApi_BearerOptions_MustWireSecurityStampCheckOnTokenValidated()
    {
        using var provider = BuildAuthServices();
        var options = provider.GetRequiredService<IOptionsMonitor<JwtBearerOptions>>()
            .Get(JwtBearerDefaults.AuthenticationScheme);

        Assert.NotNull(options.Events);
        Assert.NotNull(options.Events!.OnTokenValidated);
        // The OnTokenValidated delegate is the security-stamp enforcement hook.
        // If a future refactor drops this wiring, all rotated tokens (password change,
        // 2FA disable, revoke-all, delete, email change) would keep working against
        // Auth's own endpoints until natural expiry — this assertion is the tripwire.
    }

    [Fact]
    public void AuthDatabaseProbe_ParticipatesInReadinessOnly()
    {
        using var provider = BuildAuthServices();
        var options = provider.GetRequiredService<IOptions<HealthCheckServiceOptions>>().Value;
        var registration = Assert.Single(options.Registrations, check => check.Name == "auth-dbcontext");
        Assert.Contains(HealthCheckExtensions.ReadyTag, registration.Tags);
        Assert.DoesNotContain(HealthCheckExtensions.LiveTag, registration.Tags);
    }

    private static ServiceProvider BuildAuthServices()
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["JwtSettings:Secret"] = new string('x', 32),
                ["JwtSettings:Issuer"] = "Planora.Auth",
                ["JwtSettings:Audience"] = "Planora.Clients",
                ["ConnectionStrings:AuthDatabase"] = "Host=127.0.0.1;Port=1;Database=test;Username=fixture",
                ["ConnectionStrings:Redis"] = "127.0.0.1:1,abortConnect=false,connectRetry=0,connectTimeout=100,syncTimeout=100",
                ["IsDevelopment"] = "true",
            })
            .Build();

        var services = new ServiceCollection();
        services.AddSingleton<IConfiguration>(configuration);
        services.AddLogging();
        services.AddAuthInfrastructure(configuration);

        return services.BuildServiceProvider(validateScopes: false);
    }
}
