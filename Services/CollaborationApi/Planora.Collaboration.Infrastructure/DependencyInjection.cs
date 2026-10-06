using Planora.BuildingBlocks.Application.Context;
using Planora.BuildingBlocks.Application.Outbox;
using Planora.BuildingBlocks.Infrastructure.Grpc;
using Planora.Collaboration.Application.Services;
using Planora.Collaboration.Infrastructure.Grpc;
using Planora.Collaboration.Infrastructure.Persistence.Repositories;
using Microsoft.Extensions.Caching.Memory;
using Planora.BuildingBlocks.Infrastructure.Retention;
using Planora.BuildingBlocks.Infrastructure.Retention.Policies;

namespace Planora.Collaboration.Infrastructure
{
    public static class DependencyInjection
    {
        public static IServiceCollection AddCollaborationInfrastructure(
            this IServiceCollection services,
            IConfiguration configuration)
        {
            var connectionString = configuration.GetConnectionString("CollaborationDatabase")
                ?? throw new InvalidOperationException("CollaborationDatabase connection string not found");

            services.AddDbContext<CollaborationDbContext>(options =>
                options.UseNpgsql(connectionString, npgsqlOptions =>
                {
                    npgsqlOptions.EnableRetryOnFailure(
                        maxRetryCount: 3,
                        maxRetryDelay: TimeSpan.FromSeconds(5),
                        errorCodesToAdd: null);
                })
                    .EnableSensitiveDataLogging(false));

            // Register CollaborationDbContext as DbContext for the OutboxProcessor.
            services.AddScoped<DbContext>(sp => sp.GetRequiredService<CollaborationDbContext>());

            // Repositories & Unit of Work
            services.AddScoped<IUnitOfWork, CollaborationUnitOfWork>();
            services.AddScoped<ICommentRepository, CommentRepository>();
            services.AddScoped<IRepository<Comment>, CommentRepository>();
            services.AddScoped<IOutboxRepository, OutboxRepository>();
            // Inbox for consumer idempotency (dedup of replayed integration events).
            services.AddScoped<Planora.BuildingBlocks.Infrastructure.Inbox.IInboxRepository, InboxRepository>();

            // Outbox Processor — ships NotificationEvent to RabbitMQ (INV-COMM-3).
            services.AddHostedService<Planora.BuildingBlocks.Infrastructure.Outbox.OutboxProcessor>();

            // Retention: purge processed outbox/inbox rows past their configured window. Safety-gated
            // (advisory lock + tripwire + dry-run) and disabled by default until an operator opts in.
            services.AddRetention(configuration)
                .AddRetentionPolicy<ProcessedMessagePurgePolicy>()
                .AddRetentionPolicy<SoftDeletedPurgePolicy<Planora.Collaboration.Domain.Entities.Comment>>();

            // Current user context
            services.AddHttpContextAccessor();
            services.AddScoped<ICurrentUserContext, Planora.BuildingBlocks.Infrastructure.Context.CurrentUserContext>();

            // gRPC clients — both carry x-service-key via the shared interceptor (INV-COMM-2).
            services.AddSingleton<ServiceKeyClientInterceptor>();

            // Task access authorisation → TodoApi gRPC (port 5282 local / env-configurable).
            var todoGrpcUrl = configuration["GrpcServices:TodoApi"]
                ?? configuration["Services:Todo:Url"]
                ?? "http://localhost:5101";
            services.AddGrpcClient<Planora.GrpcContracts.TodoService.TodoServiceClient>(o =>
                    o.Address = new Uri(todoGrpcUrl))
                .AddInterceptor<ServiceKeyClientInterceptor>();
            services.AddScoped<ITaskAccessService, TaskAccessGrpcClient>();

            // Avatar enrichment → AuthApi gRPC, wrapped in an in-memory cache so paged comment
            // reads do not hammer Auth for the same authors repeatedly.
            var authGrpcUrl = configuration["GrpcServices:AuthApi"]
                ?? configuration["Services:Auth:Url"]
                ?? "http://localhost:5031";
            services.AddGrpcClient<Planora.GrpcContracts.AuthService.AuthServiceClient>(o =>
                    o.Address = new Uri(authGrpcUrl))
                .AddInterceptor<ServiceKeyClientInterceptor>();
            services.AddScoped<UserGrpcService>();
            services.AddScoped<IUserService>(sp => new CachingUserService(
                sp.GetRequiredService<UserGrpcService>(),
                sp.GetRequiredService<IMemoryCache>(),
                sp.GetRequiredService<ILogger<CachingUserService>>()));

            services.AddHealthChecks()
                .AddDbContextCheck<CollaborationDbContext>("collaboration-dbcontext");

            return services;
        }
    }
}
