using System.Reflection;
using Planora.Category.Application.Features.Categories.Events;
using Planora.Category.Application.Features.IntegrationEvents;
using Planora.Category.Domain.Events;
using Planora.BuildingBlocks.Application.Behaviors;
using Planora.BuildingBlocks.Application.Messaging;
using Planora.BuildingBlocks.Application.Services;

namespace Planora.Category.Application
{
    public static class DependencyInjection
    {
        public static IServiceCollection AddCategoryApplication(this IServiceCollection services)
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

            // Domain Event Handlers
            services.AddScoped<IDomainEventHandler<CategoryDeletedDomainEvent>, CategoryDeletedDomainEventHandler>();

            // Integration Event Handlers
            services.AddScoped<UserDeletedEventConsumer>();

            return services;
        }
    }
}
