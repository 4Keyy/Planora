using Serilog;
using Serilog.Events;
using Serilog.Expressions;
using Serilog.Sinks.File;
using Serilog.Templates;

namespace Planora.BuildingBlocks.Infrastructure.Logging;

/// <summary>
/// Centralized logging configuration for the entire system.
/// Provides structured logging with correlation ID, distributed tracing,
/// and proper file rotation.
/// </summary>
public static class LoggingConfiguration
{
    private const string OutputTemplate = "{Timestamp:yyyy-MM-dd HH:mm:ss.fff zzz} [{Level:u3}] {Service}@{Environment} {MachineName} TraceId:{TraceId} SpanId:{SpanId} UserId:{UserId} {RequestPath} {Operation} {EventType} {Message:lj}{NewLine}{Exception}";

    /// <summary>
    /// Configures Serilog for the application.
    /// </summary>
    /// <param name="builder">The host builder.</param>
    /// <param name="serviceName">The name of the service.</param>
    /// <param name="logsDirectory">Directory for log files.</param>
    /// <returns>The configured host builder.</returns>
    public static IHostBuilder ConfigureSerilog(this IHostBuilder builder, string serviceName, string logsDirectory = "logs")
    {
        return builder.UseSerilog((context, services, configuration) =>
        {
            var env = context.HostingEnvironment.EnvironmentName;
            var logDirectory = Path.Combine(logsDirectory, serviceName);

            // Ensure log directory exists
            Directory.CreateDirectory(logDirectory);

            configuration
                .MinimumLevel.Debug()
                .MinimumLevel.Override("Microsoft", LogEventLevel.Information)
                .MinimumLevel.Override("Microsoft.AspNetCore", LogEventLevel.Warning)
                .MinimumLevel.Override("System", LogEventLevel.Warning)
                .Enrich.FromLogContext()
                .Enrich.WithMachineName()
                .Enrich.WithEnvironmentName()
                .Enrich.WithProcessId()
                .Enrich.WithThreadId()
                .Enrich.WithProperty("Service", serviceName)
                .Enrich.With<CorrelationIdEnricher>()
                .Enrich.With<UserIdEnricher>()
                .Enrich.With<SpanIdEnricher>()
                .Enrich.With<OperationEnricher>()
                .Enrich.With<EventTypeEnricher>()
                .WriteTo.Console(
                    outputTemplate: OutputTemplate,
                    theme: Serilog.Sinks.SystemConsole.Themes.AnsiConsoleTheme.Code)
                .WriteTo.File(
                    path: Path.Combine(logDirectory, "app-.log"),
                    rollingInterval: RollingInterval.Day,
                    outputTemplate: OutputTemplate,
                    retainedFileCountLimit: 30,
                    fileSizeLimitBytes: 10 * 1024 * 1024, // 10MB
                    rollOnFileSizeLimit: true)
                .WriteTo.File(
                    path: Path.Combine(logDirectory, "errors-.log"),
                    rollingInterval: RollingInterval.Day,
                    outputTemplate: OutputTemplate,
                    retainedFileCountLimit: 30,
                    fileSizeLimitBytes: 10 * 1024 * 1024, // 10MB
                    rollOnFileSizeLimit: true,
                    restrictedToMinimumLevel: LogEventLevel.Warning)
                .WriteTo.Conditional(
                    evt => evt.Level >= LogEventLevel.Information,
                    wt => wt.Seq("http://localhost:5341")); // Seq server
        });
    }

    /// <summary>
    /// Configures Serilog for web applications.
    /// Call this on IHostBuilder, and then use ConfigureWebAppLogging on IApplicationBuilder.
    /// </summary>
    public static IHostBuilder ConfigureWebSerilog(this IHostBuilder builder, string serviceName, string logsDirectory = "logs")
    {
        return builder.ConfigureSerilog(serviceName, logsDirectory);
    }

    /// <summary>
    /// Configures request logging for web applications.
    /// Call this on IApplicationBuilder in Program.cs.
    /// </summary>
    public static IApplicationBuilder ConfigureWebAppLogging(this IApplicationBuilder builder)
    {
        return builder.UseSerilogRequestLogging(options =>
        {
            options.MessageTemplate = "HTTP {RequestMethod} {RequestPath} responded {StatusCode} in {Elapsed:0.0000} ms";
            options.EnrichDiagnosticContext = (diagnosticContext, httpContext) =>
            {
                diagnosticContext.Set("RequestHost", httpContext.Request.Host.Value ?? "unknown");
                diagnosticContext.Set("RequestScheme", httpContext.Request.Scheme);
                diagnosticContext.Set("ResponseContentLength", httpContext.Response.ContentLength ?? 0);
                diagnosticContext.Set("UserAgent", httpContext.Request.Headers["User-Agent"].FirstOrDefault() ?? "unknown");
                // Don't log sensitive headers
                if (httpContext.Request.Headers.ContainsKey("Authorization"))
                {
                    diagnosticContext.Set("HasAuthorization", true);
                }
            };
        });
    }
}