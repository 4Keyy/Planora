using Microsoft.Extensions.Configuration;
using Planora.BuildingBlocks.Infrastructure.Logging;
using Serilog;

namespace Planora.UnitTests.Services.Infrastructure;

/// <summary>
/// Pins down the no-op-by-default behaviour of the Grafana Loki sink wiring. The CLI / Fly
/// deployments rely on this: shipping the binary with no Loki endpoint configured must NOT
/// open a background connection or surface log noise.
/// </summary>
public sealed class SerilogConfigurationTests
{
    private const string ServiceName = "test-service";
    private const string Environment = "Test";

    // Env-var keys consulted by the helper as a fallback to IConfiguration.
    private static readonly string[] LokiEnvKeys =
    {
        "LOKI_URL",
        "LOKI_USER",
        "LOKI_TOKEN",
    };

    [Fact]
    [Trait("TestType", "Observability")]
    [Trait("TestType", "Regression")]
    public void TryAddLokiSink_ReturnsFalse_WhenNoUrlIsConfigured()
    {
        using var env = new EnvironmentScrub(LokiEnvKeys);
        var configuration = new ConfigurationBuilder().Build();
        var loggerConfig = new LoggerConfiguration();

        var added = SerilogConfiguration.TryAddLokiSink(loggerConfig, configuration, ServiceName, Environment);

        Assert.False(added);
    }

    [Fact]
    [Trait("TestType", "Observability")]
    [Trait("TestType", "Regression")]
    public void TryAddLokiSink_ReturnsTrue_WhenConfigUrlIsPresent()
    {
        using var env = new EnvironmentScrub(LokiEnvKeys);
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Serilog:Loki:Url"] = "http://loki.example.test/loki/api/v1/push",
            })
            .Build();
        var loggerConfig = new LoggerConfiguration();

        var added = SerilogConfiguration.TryAddLokiSink(loggerConfig, configuration, ServiceName, Environment);

        Assert.True(added);

        // The sink must not raise on construction; CreateLogger must succeed even when the
        // upstream Loki endpoint is unreachable (the sink batches asynchronously).
        using var logger = loggerConfig.CreateLogger();
        Assert.NotNull(logger);
    }

    [Fact]
    [Trait("TestType", "Observability")]
    [Trait("TestType", "Regression")]
    public void TryAddLokiSink_ReturnsTrue_WhenEnvVarUrlIsPresent()
    {
        using var env = new EnvironmentScrub(LokiEnvKeys);
        System.Environment.SetEnvironmentVariable("LOKI_URL", "http://loki.example.test/loki/api/v1/push");
        var configuration = new ConfigurationBuilder().Build();
        var loggerConfig = new LoggerConfiguration();

        var added = SerilogConfiguration.TryAddLokiSink(loggerConfig, configuration, ServiceName, Environment);

        Assert.True(added);
    }

    [Fact]
    [Trait("TestType", "Observability")]
    [Trait("TestType", "Regression")]
    public void TryAddLokiSink_AcceptsCredentialsFromConfiguration()
    {
        using var env = new EnvironmentScrub(LokiEnvKeys);
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Serilog:Loki:Url"] = "http://loki.example.test/loki/api/v1/push",
                ["Serilog:Loki:Credentials:Login"] = "tenant-123",
                ["Serilog:Loki:Credentials:Password"] = "glc_abc123",
            })
            .Build();
        var loggerConfig = new LoggerConfiguration();

        var added = SerilogConfiguration.TryAddLokiSink(loggerConfig, configuration, ServiceName, Environment);

        Assert.True(added);
        using var logger = loggerConfig.CreateLogger();
        Assert.NotNull(logger);
    }

    [Fact]
    [Trait("TestType", "Observability")]
    public void TryAddLokiSink_Throws_WhenLoggerConfigIsNull()
    {
        var configuration = new ConfigurationBuilder().Build();
        Assert.Throws<ArgumentNullException>(() =>
            SerilogConfiguration.TryAddLokiSink(null!, configuration, ServiceName, Environment));
    }

    [Fact]
    [Trait("TestType", "Observability")]
    public void TryAddLokiSink_Throws_WhenServiceNameIsBlank()
    {
        var configuration = new ConfigurationBuilder().Build();
        var loggerConfig = new LoggerConfiguration();
        Assert.Throws<ArgumentException>(() =>
            SerilogConfiguration.TryAddLokiSink(loggerConfig, configuration, " ", Environment));
    }

    /// <summary>
    /// Snapshots a fixed set of env vars on construction and restores their original values
    /// on dispose. Used to isolate Loki tests from the CI environment that might already
    /// have <c>LOKI_*</c> variables defined for other reasons.
    /// </summary>
    private sealed class EnvironmentScrub : IDisposable
    {
        private readonly Dictionary<string, string?> _previous;

        public EnvironmentScrub(IEnumerable<string> keys)
        {
            _previous = keys.ToDictionary(k => k, System.Environment.GetEnvironmentVariable);
            foreach (var key in _previous.Keys)
            {
                System.Environment.SetEnvironmentVariable(key, null);
            }
        }

        public void Dispose()
        {
            foreach (var (key, value) in _previous)
            {
                System.Environment.SetEnvironmentVariable(key, value);
            }
        }
    }
}
