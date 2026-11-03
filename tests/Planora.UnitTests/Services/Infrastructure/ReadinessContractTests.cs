using System.Net;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Planora.BuildingBlocks.Infrastructure;
using Planora.BuildingBlocks.Infrastructure.Extensions;

namespace Planora.UnitTests.Services.Infrastructure;

public sealed class ReadinessContractTests
{
    [Theory]
    [InlineData("AuthDatabase")]
    [InlineData("TodoDatabase")]
    [InlineData("CategoryDatabase")]
    [InlineData("CollaborationDatabase")]
    [InlineData("MessagingDatabase")]
    public void SharedRegistration_IncludesDatabaseInReadiness(string connectionName)
    {
        var services = new ServiceCollection();
        services.AddBuildingBlocksInfrastructure(Configuration(connectionName), connectionName);
        using var provider = services.BuildServiceProvider();

        var registrations = provider.GetRequiredService<IOptions<HealthCheckServiceOptions>>().Value.Registrations;
        var database = Assert.Single(registrations, registration => registration.Name == "Database");
        Assert.Contains(HealthCheckExtensions.ReadyTag, database.Tags);
        Assert.Contains("db", database.Tags);
        Assert.Contains("postgres", database.Tags);
        Assert.DoesNotContain(HealthCheckExtensions.LiveTag, database.Tags);
        var broker = Assert.Single(registrations, registration => registration.Name == "rabbitmq");
        Assert.Equal(HealthStatus.Degraded, broker.FailureStatus);
        Assert.DoesNotContain(HealthCheckExtensions.ReadyTag, broker.Tags);
        Assert.DoesNotContain(HealthCheckExtensions.LiveTag, broker.Tags);
    }

    [Theory]
    [InlineData(HealthStatus.Unhealthy, HealthStatus.Healthy, HttpStatusCode.ServiceUnavailable, "Unhealthy")]
    [InlineData(HealthStatus.Healthy, HealthStatus.Degraded, HttpStatusCode.OK, "Degraded")]
    public async Task Probes_UseRealRegistrationTagsAndKeepDependencyFailuresOutOfLiveness(
        HealthStatus databaseStatus, HealthStatus brokerStatus, HttpStatusCode readyStatus, string aggregateStatus)
    {
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = "Testing" });
        builder.Configuration.Sources.Clear();
        builder.Configuration.AddInMemoryCollection();
        builder.Logging.ClearProviders();
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        builder.Services.AddBuildingBlocksInfrastructure(Configuration("TodoDatabase"), "TodoDatabase");
        // Replace only the probes, retaining the production DI names, statuses and tags.
        // No Redis, broker or database connection is opened by this host.
        builder.Services.PostConfigure<HealthCheckServiceOptions>(options =>
        {
            foreach (var registration in options.Registrations)
            {
                var status = registration.Name == "Database" ? databaseStatus : brokerStatus;
                registration.Factory = _ => new FixedHealthCheck(status);
            }
        });
        await using var app = builder.Build();
        app.MapPlanoraHealthEndpoints();
        await app.StartAsync();
        try
        {
            var addresses = app.Services.GetRequiredService<IServer>()
                .Features.Get<IServerAddressesFeature>()!;
            using var client = new HttpClient { BaseAddress = new Uri(Assert.Single(addresses.Addresses)) };
            var live = await client.GetAsync("/health/live");
            var ready = await client.GetAsync("/health/ready");
            var aggregate = await client.GetAsync("/health");

            Assert.Equal(HttpStatusCode.OK, live.StatusCode);
            Assert.Equal(readyStatus, ready.StatusCode);
            Assert.Equal(aggregateStatus, await aggregate.Content.ReadAsStringAsync());
            Assert.Contains("no-store", ready.Headers.CacheControl!.ToString());
        }
        finally
        {
            await app.StopAsync();
        }
    }

    private static IConfiguration Configuration(string connectionName) => new ConfigurationBuilder()
        .AddInMemoryCollection(new Dictionary<string, string?>
        {
            [$"ConnectionStrings:{connectionName}"] = "Host=unused.invalid;Database=synthetic"
        }).Build();

    private sealed class FixedHealthCheck(HealthStatus status) : IHealthCheck
    {
        public Task<HealthCheckResult> CheckHealthAsync(
            HealthCheckContext context, CancellationToken cancellationToken = default) =>
            Task.FromResult(new HealthCheckResult(status));
    }
}
