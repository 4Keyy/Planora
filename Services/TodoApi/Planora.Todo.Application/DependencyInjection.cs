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
                // 1. UnhandledExceptionBehavior — must be outermost to catch ALL exceptions including validation failures
                // 2. LoggingBehavior            — logs full request lifecycle including exceptions
                // 3. ValidationBehavior         — throws ValidationException (caught by #1 and logged by #2)
                // 4. PerformanceBehavior        — measures only handler execution time (excludes validation overhead)
                cfg.AddOpenBehavior(typeof(UnhandledExceptionBehavior<,>));
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
