using Planora.Auth.Api.Configuration;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace Planora.UnitTests.Services.AuthApi.Api;

public sealed class OpenTelemetryExtensionsTests
{
    [Fact]
    [Trait("TestType", "Integration")]
    [Trait("TestType", "Module")]
    [Trait("TestType", "Regression")]
    public async Task AddOpenTelemetryConfiguration_ShouldRegisterTelemetryWithConfiguredServiceIdentity()
    {
        var services = new ServiceCollection();
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["OpenTelemetry:ServiceName"] = "AuthApi.Tests",
                ["OpenTelemetry:ServiceVersion"] = "9.9.9"
            })
            .Build();

        var returned = services.AddOpenTelemetryConfiguration(configuration);

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
    public void AddOpenTelemetryConfiguration_ShouldUseDefaultsWhenConfigurationIsMissing()
    {
        var services = new ServiceCollection();
        var configuration = new ConfigurationBuilder().Build();

        var returned = services.AddOpenTelemetryConfiguration(configuration);

        Assert.Same(services, returned);
        Assert.NotEmpty(services);
    }
}
