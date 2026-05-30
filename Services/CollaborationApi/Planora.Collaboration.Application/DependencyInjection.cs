using System.Reflection;
using Planora.BuildingBlocks.Application.Behaviors;
using Planora.Collaboration.Application.Features.IntegrationEvents;
using Microsoft.Extensions.DependencyInjection;
using FluentValidation;

namespace Planora.Collaboration.Application
{
    public static class DependencyInjection
    {
        public static IServiceCollection AddCollaborationApplication(this IServiceCollection services)
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

            // Integration Event Handlers (Inbox side — materialise system/genesis comments,
            // cascade-delete on task deletion, clean up on user deletion).
            services.AddScoped<TaskCreatedEventConsumer>();
            services.AddScoped<TaskActivityEventConsumer>();
            services.AddScoped<TaskDeletedEventConsumer>();
            services.AddScoped<UserDeletedEventConsumer>();

            return services;
        }
    }
}
