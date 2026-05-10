using Planora.BuildingBlocks.Infrastructure.Caching;
using Planora.BuildingBlocks.Infrastructure.Context;
using Planora.BuildingBlocks.Infrastructure.Messaging;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Microsoft.Extensions.Logging;

namespace Planora.BuildingBlocks.Infrastructure
{
    public static class DependencyInjection
    {
        public static IServiceCollection AddBuildingBlocksInfrastructure(
            this IServiceCollection services,
            IConfiguration configuration,
            string? dbConnectionStringName = null)
        {
            // Caching
            services.Configure<CacheOptions>(configuration.GetSection("Cache"));
            services.AddSingleton<ICacheService, CacheService>();
            services.AddSingleton<ICacheInvalidator, CacheInvalidator>();

            // Current User
            services.AddScoped<ICurrentUserContext, CurrentUserContext>();
            services.AddHttpContextAccessor();
            services.AddScoped<
                Planora.BuildingBlocks.Infrastructure.Persistence.ICurrentUserService,
                Planora.BuildingBlocks.Infrastructure.Persistence.CurrentUserService>();

            // Redis
            var redisConnection = configuration.GetConnectionString("Redis") 
                ?? configuration.GetSection("Redis:Configuration").Value 
                ?? "localhost:6379";
            
            services.AddStackExchangeRedisCache(options =>
            {
                options.Configuration = redisConnection;
                options.InstanceName = "planora_";
            });

            // Memory Cache
            services.AddMemoryCache(options =>
            {
                options.SizeLimit = 104857600; // 100 MB
            });

            // Messaging & Event Bus
            services.AddSingleton<IRabbitMqConnectionManager>(sp =>
            {
                var logger = sp.GetRequiredService<ILogger<RabbitMqConnectionManager>>();
                return new RabbitMqConnectionManager(configuration, logger);
            });
            services.AddSingleton<IEventBus, RabbitMqEventBus>();

            services.AddScoped<
                Planora.BuildingBlocks.Infrastructure.IDomainEventDispatcher,
                Planora.BuildingBlocks.Infrastructure.DomainEventDispatcher>();

            services.AddScoped<
                Planora.BuildingBlocks.Infrastructure.Messaging.IDomainEventDispatcher,
                Planora.BuildingBlocks.Infrastructure.Messaging.DomainEventDispatcher>();

            // Deep Health Checks
            var dbConn = configuration.GetConnectionString(dbConnectionStringName ?? "DefaultConnection") 
                ?? configuration.GetConnectionString("DefaultConnection");

            var redisConn = configuration.GetConnectionString("Redis") 
                ?? configuration.GetSection("Redis:Configuration").Value;

            var rabbitHost = configuration.GetConnectionString("RabbitMQ") 
                ?? configuration.GetSection("RabbitMq:HostName").Value;

            var hcBuilder = services.AddHealthChecks();

            if (!string.IsNullOrEmpty(dbConn))
                hcBuilder.AddNpgSql(dbConn, name: "Database", tags: new[] { "db", "postgres" });

            if (!string.IsNullOrEmpty(redisConn))
                hcBuilder.AddRedis(redisConn, name: "Redis", tags: new[] { "cache", "redis" });

            // TODO: Fix RabbitMQ health check - need proper factory implementation for IConnection
            // if (!string.IsNullOrEmpty(rabbitHost))
            // {
            //     var rabbitUri = rabbitHost.StartsWith("amqp") 
            //         ? rabbitHost 
            //         : $"amqp://guest:guest@{rabbitHost}:5672/";
            //
            //     hcBuilder.AddRabbitMQ(rabbitUri, name: "RabbitMQ", tags: new[] { "messaging", "rabbitmq" });
            // }

            return services;
        }
    }
}
