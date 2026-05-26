using Planora.BuildingBlocks.Infrastructure.Logging.Enrichers;
using Serilog;
using Serilog.Configuration;
using Serilog.Events;
using Serilog.Exceptions;
using Serilog.Formatting.Compact;
using Serilog.Sinks.Grafana.Loki;

namespace Planora.BuildingBlocks.Infrastructure.Logging;

/// <summary>
/// Unified Serilog configuration for all microservices.
/// Provides structured logging, distributed tracing, and enterprise-grade observability.
/// </summary>
public static class SerilogConfiguration
{
    /// <summary>
    /// Extension method to configure Serilog for ASP.NET Core WebApplicationBuilder.
    /// </summary>
    public static WebApplicationBuilder ConfigureEnterpriseLogging(
        this WebApplicationBuilder builder,
        string serviceName)
    {
        builder.Host.UseSerilog((context, services, loggerConfig) =>
        {
            var httpContextAccessor = services.GetService<IHttpContextAccessor>();
            var environment = Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT") ?? "Production";
            var logsPath = Path.Combine(AppContext.BaseDirectory, "logs", serviceName);
            Directory.CreateDirectory(logsPath);

            loggerConfig
                .MinimumLevel.Information()
                .MinimumLevel.Override("Microsoft", LogEventLevel.Warning)
                .MinimumLevel.Override("Microsoft.EntityFrameworkCore", LogEventLevel.Warning)
                .MinimumLevel.Override("Microsoft.AspNetCore", LogEventLevel.Warning)
                .MinimumLevel.Override("System", LogEventLevel.Warning)
                .Enrich.FromLogContext()
                .Enrich.WithMachineName()
                .Enrich.WithEnvironmentName()
                .Enrich.WithProcessId()
                .Enrich.WithProcessName()
                .Enrich.WithThreadId()
                .Enrich.WithExceptionDetails()
                .Enrich.WithProperty("ServiceName", serviceName)
                .Enrich.WithProperty("Environment", environment)
                .Enrich.With(new ServiceNameEnricher(serviceName));

            if (httpContextAccessor != null)
            {
                loggerConfig
                    .Enrich.With(new Enrichers.UserIdEnricher(httpContextAccessor))
                    .Enrich.With(new Enrichers.OperationEnricher(httpContextAccessor))
                    .Enrich.With(new Enrichers.EventTypeEnricher(httpContextAccessor))
                    .Enrich.With(new Enrichers.RequestPathEnricher(httpContextAccessor));
            }

            loggerConfig.WriteTo.Console(
                outputTemplate: "[{Timestamp:HH:mm:ss} {Level:u3}] [{ServiceName}] {Message:lj}{NewLine}{Exception}",
                restrictedToMinimumLevel: LogEventLevel.Information);

            loggerConfig.WriteTo.File(
                path: Path.Combine(logsPath, "app-.log"),
                rollingInterval: RollingInterval.Day,
                retainedFileCountLimit: 30,
                fileSizeLimitBytes: 100_000_000,
                rollOnFileSizeLimit: true,
                shared: true,
                outputTemplate: "{Timestamp:yyyy-MM-dd HH:mm:ss.fff zzz} [{Level:u3}] {Message:lj}{NewLine}{Exception}",
                restrictedToMinimumLevel: LogEventLevel.Information);

            loggerConfig.WriteTo.File(
                path: Path.Combine(logsPath, "errors-.log"),
                rollingInterval: RollingInterval.Day,
                retainedFileCountLimit: 60,
                fileSizeLimitBytes: 50_000_000,
                rollOnFileSizeLimit: true,
                shared: true,
                restrictedToMinimumLevel: LogEventLevel.Error);

            loggerConfig.WriteTo.File(
                new CompactJsonFormatter(),
                path: Path.Combine(logsPath, "structured-.json"),
                rollingInterval: RollingInterval.Day,
                retainedFileCountLimit: 30,
                fileSizeLimitBytes: 100_000_000,
                rollOnFileSizeLimit: true,
                shared: true,
                restrictedToMinimumLevel: LogEventLevel.Information);

            var seqUrl = context.Configuration["Serilog:Seq:Url"];
            if (!string.IsNullOrEmpty(seqUrl))
            {
                loggerConfig.WriteTo.Seq(
                    serverUrl: seqUrl,
                    apiKey: context.Configuration["Serilog:Seq:ApiKey"],
                    restrictedToMinimumLevel: LogEventLevel.Information);
            }

            TryAddLokiSink(loggerConfig, context.Configuration, serviceName, environment);
        });

        return builder;
    }

    /// <summary>
    /// Extension method to configure Serilog for standalone hosts (background services, workers).
    /// </summary>
    public static IHostBuilder ConfigureEnterpriseLogging(
        this IHostBuilder builder,
        string serviceName)
    {
        builder.UseSerilog((context, services, loggerConfig) =>
        {
            var environment = Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT") ?? "Production";
            var logsPath = Path.Combine(AppContext.BaseDirectory, "logs", serviceName);
            Directory.CreateDirectory(logsPath);

            loggerConfig
                .MinimumLevel.Information()
                .MinimumLevel.Override("Microsoft", LogEventLevel.Warning)
                .MinimumLevel.Override("System", LogEventLevel.Warning)
                .Enrich.FromLogContext()
                .Enrich.WithMachineName()
                .Enrich.WithEnvironmentName()
                .Enrich.WithProcessId()
                .Enrich.WithExceptionDetails()
                .Enrich.WithProperty("ServiceName", serviceName)
                .Enrich.WithProperty("Environment", environment)
                .Enrich.With(new ServiceNameEnricher(serviceName));

            loggerConfig.WriteTo.Console();
            loggerConfig.WriteTo.File(
                path: Path.Combine(logsPath, "app-.log"),
                rollingInterval: RollingInterval.Day);

            var seqUrl = context.Configuration["Serilog:Seq:Url"];
            if (!string.IsNullOrEmpty(seqUrl))
            {
                loggerConfig.WriteTo.Seq(serverUrl: seqUrl, apiKey: context.Configuration["Serilog:Seq:ApiKey"]);
            }

            TryAddLokiSink(loggerConfig, context.Configuration, serviceName, environment);
        });

        return builder;
    }

    /// <summary>
    /// Adds a Grafana Loki sink when a Loki endpoint is configured; otherwise a no-op.
    /// Centralized so both the WebApplicationBuilder and the IHostBuilder paths produce
    /// identical, testable wiring.
    /// </summary>
    /// <param name="loggerConfig">The Serilog configuration builder being augmented.</param>
    /// <param name="configuration">App configuration (env vars + appsettings).</param>
    /// <param name="serviceName">Service name; emitted as the Loki <c>service_name</c> label.</param>
    /// <param name="environment">Deployment environment; emitted as the <c>environment</c> label.</param>
    /// <returns><c>true</c> when a sink was added, <c>false</c> when the Loki URL was absent.</returns>
    /// <remarks>
    /// Configuration keys (all optional except the URL):
    /// <list type="bullet">
    /// <item><description><c>Serilog:Loki:Url</c> (or <c>LOKI_URL</c> env var) — Loki push endpoint, e.g.
    /// <c>https://logs-prod-eu-west-0.grafana.net/loki/api/v1/push</c>.</description></item>
    /// <item><description><c>Serilog:Loki:Credentials:Login</c> + <c>:Password</c> — Basic auth. For
    /// Grafana Cloud, Login is the tenant/user id and Password is the instance API token.</description></item>
    /// <item><description><c>Serilog:Loki:MinimumLevel</c> — minimum level shipped (default
    /// <c>Information</c>).</description></item>
    /// </list>
    /// Labels emitted: <c>service_name</c>, <c>environment</c>. The sink batches in the background
    /// so a slow or unreachable Loki endpoint does not block the request thread.
    /// </remarks>
    public static bool TryAddLokiSink(
        LoggerConfiguration loggerConfig,
        IConfiguration configuration,
        string serviceName,
        string environment)
    {
        ArgumentNullException.ThrowIfNull(loggerConfig);
        ArgumentNullException.ThrowIfNull(configuration);
        ArgumentException.ThrowIfNullOrWhiteSpace(serviceName);

        var lokiUrl = configuration["Serilog:Loki:Url"]
            ?? Environment.GetEnvironmentVariable("LOKI_URL");

        if (string.IsNullOrWhiteSpace(lokiUrl))
        {
            return false;
        }

        var login = configuration["Serilog:Loki:Credentials:Login"]
            ?? Environment.GetEnvironmentVariable("LOKI_USER");
        var password = configuration["Serilog:Loki:Credentials:Password"]
            ?? Environment.GetEnvironmentVariable("LOKI_TOKEN");

        LokiCredentials? credentials = null;
        if (!string.IsNullOrWhiteSpace(login) && !string.IsNullOrWhiteSpace(password))
        {
            credentials = new LokiCredentials
            {
                Login = login,
                Password = password,
            };
        }

        var minLevelText = configuration["Serilog:Loki:MinimumLevel"] ?? "Information";
        var minLevel = Enum.TryParse<LogEventLevel>(minLevelText, ignoreCase: true, out var parsed)
            ? parsed
            : LogEventLevel.Information;

        var labels = new[]
        {
            new LokiLabel { Key = "service_name", Value = serviceName },
            new LokiLabel { Key = "environment", Value = string.IsNullOrWhiteSpace(environment) ? "Production" : environment },
        };

        loggerConfig.WriteTo.GrafanaLoki(
            uri: lokiUrl,
            labels: labels,
            credentials: credentials,
            restrictedToMinimumLevel: minLevel);

        return true;
    }
}
