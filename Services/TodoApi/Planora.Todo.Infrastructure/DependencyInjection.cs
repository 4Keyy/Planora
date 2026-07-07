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
using Planora.BuildingBlocks.Infrastructure.Retention;
using Planora.BuildingBlocks.Infrastructure.Retention.Policies;

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

            // Immediate outbox dispatch: an interceptor pulses OutboxSignal the moment a
            // task-lifecycle event commits, so the OutboxProcessor publishes it in milliseconds
            // (the Collaboration "ветка" system comment then appears near-instantly) instead of
            // waiting out the poll interval. Singleton signal shared with the hosted processor;
            // scoped interceptor so its "did this save add an outbox row?" flag is per-request.
            services.AddSingleton<Planora.BuildingBlocks.Infrastructure.Outbox.OutboxSignal>();
            services.AddScoped<Planora.BuildingBlocks.Infrastructure.Outbox.OutboxNotifyInterceptor>();

            services.AddDbContext<TodoDbContext>((sp, options) =>
                options.UseNpgsql(connectionString, npgsqlOptions =>
                {
                    npgsqlOptions.EnableRetryOnFailure(
                        maxRetryCount: 3,
                        maxRetryDelay: TimeSpan.FromSeconds(5),
                        errorCodesToAdd: null);
                })
                    .AddInterceptors(sp.GetRequiredService<Planora.BuildingBlocks.Infrastructure.Outbox.OutboxNotifyInterceptor>())
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

            // Retention: purge processed outbox/inbox rows past their configured window. Safety-gated
            // (advisory lock + tripwire + dry-run) and disabled by default until an operator opts in.
            services.AddRetention(configuration)
                .AddRetentionPolicy<ProcessedMessagePurgePolicy>()
                .AddRetentionPolicy<Retention.TodoSoftDeletePurgePolicy>();

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
            // Friendship checks → Auth gRPC, wrapped in a short in-memory cache for the friend-id
            // list (the realtime feed-audience hot path). AreFriends stays uncached so every
            // authorization decision sees live friendship state. See CachingFriendshipService.
            services.AddMemoryCache();
            services.AddScoped<Services.FriendshipGrpcService>();
            services.AddScoped<IFriendshipService>(sp => new Services.CachingFriendshipService(
                sp.GetRequiredService<Services.FriendshipGrpcService>(),
                sp.GetRequiredService<Microsoft.Extensions.Caching.Memory.IMemoryCache>(),
                sp.GetRequiredService<Microsoft.Extensions.Logging.ILogger<Services.CachingFriendshipService>>()));
            // Live subtask-author identity (display name + avatar) — same Auth channel.
            services.AddScoped<IUserProfileService, Services.UserProfileGrpcService>();

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
