using System.Reflection;
using Microsoft.Extensions.DependencyInjection;
using OpenTelemetry.Metrics;
using OpenTelemetry.Resources;
using OpenTelemetry.Trace;

namespace Planora.BuildingBlocks.Infrastructure.Logging;

/// <summary>
/// Centralizes OpenTelemetry wiring across every Planora service. The single
/// <see cref="AddPlanoraTelemetry"/> entry point configures the resource, tracing,
/// metrics, and the OTLP exporter from <c>appsettings.json</c> and the standard
/// <c>OTEL_EXPORTER_OTLP_ENDPOINT</c> environment variable.
/// </summary>
/// <remarks>
/// Configuration keys (all optional):
/// <list type="bullet">
/// <item><description><c>OpenTelemetry:ServiceName</c> — overrides the <paramref name="defaultServiceName"/>.</description></item>
/// <item><description><c>OpenTelemetry:ServiceVersion</c> — defaults to the entry assembly version.</description></item>
/// <item><description><c>OpenTelemetry:OtlpEndpoint</c> — OTLP gRPC endpoint URL. Also reads
/// <c>OTEL_EXPORTER_OTLP_ENDPOINT</c>. When neither is set, the OTLP exporter is omitted entirely
/// (no background connection attempts, no log noise) — the pipeline still records spans/metrics
/// in-process so any future exporter can be added without code changes.</description></item>
/// <item><description><c>OpenTelemetry:ConsoleExporter:Enabled</c> — emit spans/metrics to stdout.
/// Defaults to <see langword="false"/>; turn on locally for debugging.</description></item>
/// <item><description><c>OpenTelemetry:Tracing:Enabled</c>, <c>OpenTelemetry:Metrics:Enabled</c> —
/// independent kill switches, default to <see langword="true"/>.</description></item>
/// </list>
/// <para>
/// Tracing instrumentation: ASP.NET Core (with <c>/health</c> filter to suppress probe noise),
/// HttpClient (covers gRPC-over-HTTP/2 transport), Entity Framework Core. Custom activity
/// sources are picked up via the <see cref="ActivitySource"/> name matching
/// <c>Planora.*</c> or the configured service name.
/// </para>
/// <para>
/// Metrics instrumentation: ASP.NET Core request metrics, HttpClient metrics, .NET runtime
/// metrics (GC, threadpool, exceptions, working set). Custom meters are picked up via the
/// same wildcard match.
/// </para>
/// <para>
/// SECURITY: <c>SetDbStatementForText</c> is DISABLED by default on EF Core instrumentation —
/// SQL text in span attributes may contain PII through parameter values. Opt in by setting
/// <c>OpenTelemetry:Tracing:CaptureDbStatementText=true</c> in development or staging
/// environments where trace-backend access is restricted and PII risk is acceptable.
/// </para>
/// </remarks>
public static class TelemetryConfiguration
{
    public const string SectionName = "OpenTelemetry";
    public const string PlanoraSourceWildcard = "Planora.*";

    public static IServiceCollection AddPlanoraTelemetry(
        this IServiceCollection services,
        IConfiguration configuration,
        string defaultServiceName)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(configuration);
        ArgumentException.ThrowIfNullOrWhiteSpace(defaultServiceName);

        var section = configuration.GetSection(SectionName);
        var serviceName = section.GetValue<string>("ServiceName") ?? defaultServiceName;
        var serviceVersion = section.GetValue<string>("ServiceVersion")
            ?? Assembly.GetEntryAssembly()?.GetName().Version?.ToString()
            ?? "1.0.0";
        var otlpEndpoint = section.GetValue<string>("OtlpEndpoint")
            ?? Environment.GetEnvironmentVariable("OTEL_EXPORTER_OTLP_ENDPOINT");
        var consoleEnabled = section.GetValue<bool>("ConsoleExporter:Enabled");
        var tracingEnabled = section.GetValue<bool?>("Tracing:Enabled") ?? true;
        var metricsEnabled = section.GetValue<bool?>("Metrics:Enabled") ?? true;
        // SECURITY: default-off. SQL text in spans leaks parameter values (potential PII).
        // Opt in per-environment via OpenTelemetry:Tracing:CaptureDbStatementText=true.
        var captureDbText = section.GetValue<bool?>("Tracing:CaptureDbStatementText") ?? false;
        var environmentName = Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT") ?? "Production";

        var otelBuilder = services.AddOpenTelemetry()
            .ConfigureResource(resource => resource
                .AddService(
                    serviceName: serviceName,
                    serviceVersion: serviceVersion,
                    serviceInstanceId: Environment.MachineName)
                .AddAttributes(new KeyValuePair<string, object>[]
                {
                    new("deployment.environment", environmentName),
                    new("service.namespace", "planora"),
                }));

        if (tracingEnabled)
        {
            otelBuilder.WithTracing(tracing =>
            {
                tracing
                    .AddSource(serviceName)
                    .AddSource(PlanoraSourceWildcard)
                    .AddAspNetCoreInstrumentation(options =>
                    {
                        options.RecordException = true;
                        // Suppress probe noise — orchestrators hit /health, /health/live, and
                        // /health/ready many times per minute.
                        options.Filter = httpContext =>
                            !httpContext.Request.Path.StartsWithSegments("/health");
                    })
                    .AddHttpClientInstrumentation(options =>
                    {
                        options.RecordException = true;
                    })
                    .AddEntityFrameworkCoreInstrumentation(options =>
                    {
                        options.SetDbStatementForText = captureDbText;
                        options.SetDbStatementForStoredProcedure = captureDbText;
                    });

                if (!string.IsNullOrWhiteSpace(otlpEndpoint))
                {
                    tracing.AddOtlpExporter(o => o.Endpoint = new Uri(otlpEndpoint));
                }

                if (consoleEnabled)
                {
                    tracing.AddConsoleExporter();
                }
            });
        }

        if (metricsEnabled)
        {
            otelBuilder.WithMetrics(metrics =>
            {
                metrics
                    .AddMeter(serviceName)
                    .AddMeter(PlanoraSourceWildcard)
                    .AddAspNetCoreInstrumentation()
                    .AddHttpClientInstrumentation()
                    .AddRuntimeInstrumentation();

                if (!string.IsNullOrWhiteSpace(otlpEndpoint))
                {
                    metrics.AddOtlpExporter(o => o.Endpoint = new Uri(otlpEndpoint));
                }

                if (consoleEnabled)
                {
                    metrics.AddConsoleExporter();
                }
            });
        }

        return services;
    }
}
