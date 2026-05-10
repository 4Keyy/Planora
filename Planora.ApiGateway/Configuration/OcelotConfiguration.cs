using Ocelot.Provider.Consul;
using Ocelot.Provider.Polly;

namespace Planora.ApiGateway.Configuration;

public static class OcelotConfiguration
{
    public static IServiceCollection AddOcelotConfiguration(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        services
            .AddOcelot(configuration)
            .AddPolly();

        return services;
    }
}
