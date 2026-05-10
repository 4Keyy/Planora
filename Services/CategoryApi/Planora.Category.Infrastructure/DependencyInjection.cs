using Planora.BuildingBlocks.Infrastructure;
using Planora.BuildingBlocks.Infrastructure.Persistence;
using Planora.BuildingBlocks.Infrastructure.Outbox;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Configuration;

namespace Planora.Category.Infrastructure
{
    public static class DependencyInjection
    {
        public static IServiceCollection AddCategoryInfrastructure(
            this IServiceCollection services,
            IConfiguration configuration)
        {
            // Database
            var connectionString = configuration.GetConnectionString("CategoryDatabase")
                                   ?? "Host=localhost;Port=5432;Database=planoracategory;Username=postgres;Password=postgres";

            services.AddDbContext<CategoryDbContext>(options =>
                options.UseNpgsql(connectionString, npgsqlOptions =>
                {
                    npgsqlOptions.EnableRetryOnFailure(
                        maxRetryCount: 5,
                        maxRetryDelay: TimeSpan.FromSeconds(30),
                        errorCodesToAdd: null);
                    npgsqlOptions.CommandTimeout(30);
                }));

            // Register CategoryDbContext as DbContext for OutboxProcessor
            services.AddScoped<DbContext>(sp => sp.GetRequiredService<CategoryDbContext>());

            // Repositories
            services.AddScoped<ICategoryRepository, CategoryRepository>();
            services.AddScoped<BuildingBlocks.Domain.Interfaces.IRepository<Domain.Entities.Category>, CategoryRepository>();
            services.AddScoped<IUnitOfWork, UnitOfWork>();
            services.AddScoped<BuildingBlocks.Infrastructure.Outbox.IOutboxRepository, Persistence.Repositories.OutboxRepository>();

            // Services
            services.AddHttpContextAccessor();
            services.AddScoped<BuildingBlocks.Infrastructure.Persistence.ICurrentUserService, CurrentUserService>();

            // Outbox Processor
            services.AddHostedService<OutboxProcessor>();

            services.AddHealthChecks()
                .AddDbContextCheck<CategoryDbContext>("category-dbcontext");

            return services;
        }
    }
}
