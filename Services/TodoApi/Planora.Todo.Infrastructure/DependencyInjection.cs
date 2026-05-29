using Planora.BuildingBlocks.Domain.Interfaces;
using Planora.BuildingBlocks.Application.Context;
using Planora.BuildingBlocks.Infrastructure.Grpc;
using Planora.BuildingBlocks.Infrastructure.Persistence;
using Planora.Todo.Domain.Entities;
using Planora.Todo.Domain.Repositories;
using Planora.Todo.Infrastructure.Persistence;
using Planora.Todo.Infrastructure.Persistence.Repositories;
using Planora.Todo.Application.Interfaces;
using Planora.Todo.Application.Services;
using Planora.Todo.Infrastructure.Grpc;
using Planora.GrpcContracts;

namespace Planora.Todo.Infrastructure
{
    public static class DependencyInjection
    {
        public static IServiceCollection AddTodoInfrastructure(
            this IServiceCollection services,
            IConfiguration configuration)
        {
            var connectionString = configuration.GetConnectionString("TodoDatabase")
                ?? throw new InvalidOperationException("TodoDatabase connection string not found");

            services.AddDbContext<TodoDbContext>(options =>
                options.UseNpgsql(connectionString, npgsqlOptions =>
                {
                    npgsqlOptions.EnableRetryOnFailure(
                        maxRetryCount: 3,
                        maxRetryDelay: TimeSpan.FromSeconds(5),
                        errorCodesToAdd: null);
                })
                    .EnableSensitiveDataLogging(false));

            // Register TodoDbContext as DbContext for the OutboxProcessor.
            services.AddScoped<DbContext>(sp => sp.GetRequiredService<TodoDbContext>());

            // Repositories & Unit of Work
            services.AddScoped<IUnitOfWork, TodoUnitOfWork>();
            services.AddScoped<ITodoRepository, TodoRepository>();
            services.AddScoped<IRepository<TodoItem>, TodoRepository>();
            services.AddScoped<IUserTodoViewPreferenceRepository, UserTodoViewPreferenceRepository>();

            // Outbox — publishes task lifecycle integration events that drive the Collaboration
            // service's comment timeline ("ветки"). INV-COMM-3.
            services.AddScoped<Planora.BuildingBlocks.Application.Outbox.IOutboxRepository,
                Persistence.Repositories.OutboxRepository>();
            services.AddHostedService<Planora.BuildingBlocks.Infrastructure.Outbox.OutboxProcessor>();

            // Services
            services.AddHttpContextAccessor();
            services.AddScoped<ICurrentUserContext, Planora.BuildingBlocks.Infrastructure.Context.CurrentUserContext>();

            // gRPC client for Auth API friendship checks
            services.AddSingleton<ServiceKeyClientInterceptor>();
            var authGrpcUrl = configuration["GrpcServices:AuthApi"]
                ?? configuration["Services:Auth:Url"]
                ?? "http://localhost:5031";
            services.AddGrpcClient<AuthService.AuthServiceClient>(o =>
                    o.Address = new Uri(authGrpcUrl))
                .AddInterceptor<ServiceKeyClientInterceptor>();
            services.AddScoped<IFriendshipService, Services.FriendshipGrpcService>();

            // gRPC client for Category API (port 5282 local / env-configurable)
            var categoryGrpcUrl = configuration["GrpcServices:CategoryApi"] ?? "http://localhost:5282";
            services.AddGrpcClient<CategoryService.CategoryServiceClient>(o =>
                    o.Address = new Uri(categoryGrpcUrl))
                .AddInterceptor<ServiceKeyClientInterceptor>();
            services.AddScoped<ICategoryGrpcClient, CategoryGrpcClient>();

            services.AddHealthChecks()
                .AddDbContextCheck<TodoDbContext>("todo-dbcontext");

            return services;
        }
    }
}
