using Planora.BuildingBlocks.Infrastructure.Configuration;

namespace Planora.Auth.Api.Configuration
{
    /// <summary>
    /// Thin Auth-side wrapper around <see cref="PlanoraSwaggerExtensions"/> that
    /// preserves the historical entry-point names <c>AddSwaggerDocumentation</c>
    /// and <c>UseSwaggerDocumentation</c> (referenced by
    /// <c>AuthApiConfigurationTests</c>). All Swagger configuration lives in
    /// the shared building-block extension.
    /// </summary>
    public static class SwaggerConfiguration
    {
        private const string DocumentTitle = "Planora Auth API";

        private const string DocumentDescription =
            "Authentication & Authorization Service with JWT, 2FA, OAuth2, and Refresh Tokens";

        public static IServiceCollection AddSwaggerDocumentation(this IServiceCollection services)
        {
            // The Auth API ships a semantic Info.Version distinct from its route key —
            // route at /swagger/v1/swagger.json, Info.Version = v1.0.0. Preserved verbatim
            // because `AuthApiConfigurationTests` pins both values.
            return services.AddPlanoraSwaggerGen(
                DocumentTitle,
                DocumentDescription,
                documentVersion: "v1",
                infoVersion: "v1.0.0");
        }

        public static IApplicationBuilder UseSwaggerDocumentation(
            this IApplicationBuilder app,
            IWebHostEnvironment env)
        {
            return app.UsePlanoraSwagger(env, DocumentTitle);
        }
    }
}
