using Planora.BuildingBlocks.Domain.Interfaces;
using Planora.BuildingBlocks.Infrastructure.Context;
using Planora.BuildingBlocks.Infrastructure.Persistence;
using Planora.GrpcContracts;
using Planora.Messaging.Application.Services;
using Planora.Messaging.Domain;
using Planora.Messaging.Infrastructure.Persistence;
using Planora.Messaging.Infrastructure.Services;

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

            // Repositories & Unit of Work
            services.AddScoped<IUnitOfWork, UnitOfWork>();
            services.AddScoped<IMessageRepository, MessageRepository>();

            // Services
            services.AddHttpContextAccessor();
            services.AddScoped<ICurrentUserContext, CurrentUserContext>();
            var authGrpcUrl = configuration["GrpcServices:AuthApi"]
                ?? configuration["Services:Auth:Url"]
                ?? "http://localhost:5030";
            services.AddGrpcClient<AuthService.AuthServiceClient>(options =>
                options.Address = new Uri(authGrpcUrl));
            services.AddScoped<IFriendshipService, FriendshipGrpcService>();

            services.AddHealthChecks()
                .AddDbContextCheck<MessagingDbContext>("messaging-dbcontext");

            return services;
        }
    }
}
