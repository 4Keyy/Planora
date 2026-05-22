using System.Reflection;
using Planora.BuildingBlocks.Application.Behaviors;
using Planora.BuildingBlocks.Application.Services;
using Planora.BuildingBlocks.Infrastructure.Services;
using Planora.Todo.Application.Features.Todos.Events;
using Planora.Todo.Application.Features.IntegrationEvents;
using Microsoft.Extensions.DependencyInjection;
using FluentValidation;

namespace Planora.Todo.Application
{
    public static class DependencyInjection
    {
        public static IServiceCollection AddTodoApplication(this IServiceCollection services)
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

            // Integration Event Handlers
            services.AddScoped<CategoryDeletedEventHandler>();
            services.AddScoped<UserDeletedEventConsumer>();

            // Business Event Logger
            services.AddScoped<IBusinessEventLogger, BusinessEventLogger>();

            return services;
        }
    }
}
