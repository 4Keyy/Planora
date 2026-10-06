using Planora.BuildingBlocks.Domain.Interfaces;
using Planora.BuildingBlocks.Application.Context;
using Planora.BuildingBlocks.Application.Outbox;
using Planora.BuildingBlocks.Infrastructure.Grpc;
using Planora.BuildingBlocks.Infrastructure.Persistence;
using Planora.GrpcContracts;
using Planora.Messaging.Application.Services;
using Planora.Messaging.Domain;
using Planora.Messaging.Infrastructure.Persistence;
using Planora.Messaging.Infrastructure.Services;
using Planora.BuildingBlocks.Infrastructure.Retention;
using Planora.BuildingBlocks.Infrastructure.Retention.Policies;

namespace Planora.Messaging.Infrastructure
{
    public static class DependencyInjection
    {
        public static IServiceCollection AddMessagingInfrastructure(
            this IServiceCollection services,
            IConfiguration configuration)
        {
            var connectionString = configuration.GetConnectionString("MessagingDatabase")
                ?? throw new InvalidOperationException("MessagingDatabase connection string not found");

            services.AddDbContext<MessagingDbContext>(options =>
                options.UseNpgsql(connectionString, npgsqlOptions =>
                {
                    npgsqlOptions.EnableRetryOnFailure(
                        maxRetryCount: 3,
                        maxRetryDelay: TimeSpan.FromSeconds(5),
                        errorCodesToAdd: null);
                })
                    .EnableSensitiveDataLogging(false));

            // Register MessagingDbContext as DbContext for the shared OutboxProcessor.
            services.AddScoped<DbContext>(sp => sp.GetRequiredService<MessagingDbContext>());

            // Repositories & Unit of Work
            services.AddScoped<IUnitOfWork, UnitOfWork>();
            services.AddScoped<IMessageRepository, MessageRepository>();
            services.AddScoped<IOutboxRepository, OutboxRepository<MessagingDbContext>>();

            // Outbox Processor — ships the message NotificationEvent to RabbitMQ (INV-COMM-3) instead of
            // SendMessageHandler publishing straight to the broker, so a notification survives a broker blip.
            services.AddHostedService<Planora.BuildingBlocks.Infrastructure.Outbox.OutboxProcessor>();

            // Retention: purge processed outbox/inbox rows past their configured window. Safety-gated
            // (advisory lock + tripwire + dry-run) and disabled by default until an operator opts in.
            services.AddRetention(configuration)
                .AddRetentionPolicy<ProcessedMessagePurgePolicy>()
                .AddRetentionPolicy<Retention.MessageRetentionPurgePolicy>();

            // Services
            services.AddHttpContextAccessor();
            services.AddScoped<ICurrentUserContext, Planora.BuildingBlocks.Infrastructure.Context.CurrentUserContext>();
            services.AddSingleton<ServiceKeyClientInterceptor>();
            var authGrpcUrl = configuration["GrpcServices:AuthApi"]
                ?? configuration["Services:Auth:Url"]
                ?? "http://localhost:5030";
            services.AddGrpcClient<AuthService.AuthServiceClient>(options =>
                    options.Address = new Uri(authGrpcUrl))
                .AddInterceptor<ServiceKeyClientInterceptor>();
            services.AddScoped<IFriendshipService, FriendshipGrpcService>();

            services.AddHealthChecks()
                .AddDbContextCheck<MessagingDbContext>("messaging-dbcontext");

            return services;
        }
    }
}
