using Planora.BuildingBlocks.Infrastructure.Logging.Enrichers;
using Serilog;
using Serilog.Events;
using Serilog.Exceptions;
using Serilog.Formatting.Compact;

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
        });

        return builder;
    }
}
