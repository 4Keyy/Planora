namespace Planora.Auth.Api.Configuration
{
    public static class OpenTelemetryExtensions
    {
        public static IServiceCollection AddOpenTelemetryConfiguration(
            this IServiceCollection services,
            IConfiguration configuration)
        {
            var serviceName = configuration.GetValue<string>("OpenTelemetry:ServiceName") ?? "AuthService";
            var serviceVersion = configuration.GetValue<string>("OpenTelemetry:ServiceVersion") ?? "1.0.0";

            services.AddOpenTelemetry()
                .ConfigureResource(resource => resource
                    .AddService(
                        serviceName: serviceName,
                        serviceVersion: serviceVersion,
                        serviceInstanceId: Environment.MachineName))
                .WithTracing(tracing => tracing
                    .AddAspNetCoreInstrumentation(options =>
                    {
                        options.RecordException = true;
                        options.Filter = (httpContext) =>
                        {
                            return !httpContext.Request.Path.StartsWithSegments("/health");
                        };
                    })
                    .AddEntityFrameworkCoreInstrumentation(options =>
                    {
                        options.SetDbStatementForText = true;
                        options.SetDbStatementForStoredProcedure = true;
                    })
                    .AddHttpClientInstrumentation(options =>
                    {
                        options.RecordException = true;
                    })
                    .AddSource(serviceName)
                    .AddConsoleExporter()
                    )
                .WithMetrics(metrics => metrics
                    .AddMeter(serviceName));

            return services;
        }
    }
}
