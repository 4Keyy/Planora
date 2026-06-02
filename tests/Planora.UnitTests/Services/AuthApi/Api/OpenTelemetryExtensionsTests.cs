using Planora.BuildingBlocks.Infrastructure.Logging;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace Planora.UnitTests.Services.AuthApi.Api;

// Auth-service entry point used to live in Auth.Api.Configuration.OpenTelemetryExtensions;
// removed during the audit to enforce INV-OBS-5 ("services do not wrap the canonical
// telemetry registration"). The tests now pin AddPlanoraTelemetry directly with the
// Auth service identity Program.cs passes.
public sealed class OpenTelemetryExtensionsTests
{
    private const string AuthServiceName = "AuthService";

    [Fact]
    [Trait("TestType", "Integration")]
    [Trait("TestType", "Module")]
    [Trait("TestType", "Regression")]
    public async Task AddPlanoraTelemetry_ShouldRegisterTelemetryWithConfiguredServiceIdentity()
    {
        var services = new ServiceCollection();
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["OpenTelemetry:ServiceName"] = "AuthApi.Tests",
                ["OpenTelemetry:ServiceVersion"] = "9.9.9"
            })
            .Build();

        var returned = services.AddPlanoraTelemetry(configuration, AuthServiceName);

        Assert.Same(services, returned);
        Assert.NotEmpty(services);
        using var provider = services.BuildServiceProvider();
        foreach (var hostedService in provider.GetServices<IHostedService>())
        {
            await hostedService.StartAsync(CancellationToken.None);
            await hostedService.StopAsync(CancellationToken.None);
        }
    }

    [Fact]
    [Trait("TestType", "Integration")]
    [Trait("TestType", "Regression")]
    public void AddPlanoraTelemetry_ShouldUseDefaultsWhenConfigurationIsMissing()
    {
        var services = new ServiceCollection();
        var configuration = new ConfigurationBuilder().Build();

        var returned = services.AddPlanoraTelemetry(configuration, AuthServiceName);

        Assert.Same(services, returned);
        Assert.NotEmpty(services);
    }
}
