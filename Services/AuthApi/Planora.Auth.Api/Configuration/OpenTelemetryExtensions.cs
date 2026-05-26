using Planora.BuildingBlocks.Infrastructure.Logging;

namespace Planora.Auth.Api.Configuration
{
    /// <summary>
    /// Thin Auth-side wrapper that preserves the historical entry-point name
    /// <c>AddOpenTelemetryConfiguration</c> (referenced by unit tests). All telemetry
    /// configuration is centralized in
    /// <see cref="TelemetryConfiguration.AddPlanoraTelemetry"/>.
    /// </summary>
    public static class OpenTelemetryExtensions
    {
        public const string DefaultServiceName = "AuthService";

        public static IServiceCollection AddOpenTelemetryConfiguration(
            this IServiceCollection services,
            IConfiguration configuration)
        {
            return services.AddPlanoraTelemetry(configuration, DefaultServiceName);
        }
    }
}
