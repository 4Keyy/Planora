using System.Reflection;
using Planora.BuildingBlocks.Application.Services;

namespace Planora.Auth.Application;

public static class DependencyInjection
{
    public static IServiceCollection AddAuthApplication(this IServiceCollection services)
    {
        var assembly = Assembly.GetExecutingAssembly();

        services.AddMediatR(cfg =>
        {
            cfg.RegisterServicesFromAssembly(assembly);
            // Pipeline order (outermost → innermost):
            // 1. LoggingBehavior    — logs full request lifecycle including exceptions, rethrows
            // 2. ValidationBehavior — throws ValidationException (caught and logged by #1)
            // 3. PerformanceBehavior — measures only handler execution time
            cfg.AddOpenBehavior(typeof(LoggingBehavior<,>));
            cfg.AddOpenBehavior(typeof(ValidationBehavior<,>));
            cfg.AddOpenBehavior(typeof(PerformanceBehavior<,>));
        });

        services.AddValidatorsFromAssembly(assembly);

        services.AddAutoMapper(cfg => cfg.AddMaps(assembly));

        // Business Event Logger

        return services;
    }
}
