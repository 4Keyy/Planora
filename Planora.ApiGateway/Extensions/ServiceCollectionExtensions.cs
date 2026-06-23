namespace Planora.ApiGateway.Extensions;

public static class ServiceCollectionExtensions
{
    public static IServiceCollection AddApiGatewayServices(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        // The gateway is a pure Ocelot reverse proxy: every client request is routed to a
        // downstream service via ocelot.json. It does not originate gRPC calls of its own, so
        // no AddGrpcClient<T> registrations live here — gRPC fan-out happens inside the services
        // that actually need it (Todo, Messaging, Collaboration, Realtime).

        // HTTP context accessor for correlation-ID propagation in cross-cutting middleware/logging.
        services.AddHttpContextAccessor();

        return services;
    }
}
