using Planora.Realtime.Infrastructure.Services;
using Planora.Realtime.Application.Interfaces;

namespace Planora.Realtime.Infrastructure;

public static class DependencyInjection
{
    public static IServiceCollection AddRealtimeInfrastructure(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        services.AddSingleton<IConnectionManager, ConnectionManager>();
        services.AddSingleton<INotificationService, NotificationService>();

        services.AddSingleton<IRabbitMqConnectionManager>(sp =>
        {
            var logger = sp.GetRequiredService<ILogger<RabbitMqConnectionManager>>();
            return new RabbitMqConnectionManager(configuration, logger);
        });

        services.AddSingleton<IEventBus>(sp =>
        {
            var connectionManager = sp.GetRequiredService<IRabbitMqConnectionManager>();
            var logger = sp.GetRequiredService<ILogger<RabbitMqEventBus>>();
            var serviceProvider = sp;

            return new RabbitMqEventBus(connectionManager, logger, serviceProvider);
        });

        return services;
    }
}
