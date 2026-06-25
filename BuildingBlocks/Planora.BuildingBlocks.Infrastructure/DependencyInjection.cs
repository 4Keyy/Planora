using Planora.BuildingBlocks.Infrastructure.Caching;
using Planora.BuildingBlocks.Application.Context;
using Planora.BuildingBlocks.Application.Messaging;
using Planora.BuildingBlocks.Infrastructure.Messaging;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Microsoft.Extensions.Logging;
using StackExchange.Redis;

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
            services.AddScoped<ICurrentUserContext, Planora.BuildingBlocks.Infrastructure.Context.CurrentUserContext>();

            // Business event logger: interface in Application.Services, Serilog
            // implementation in Infrastructure.Services. Registering it once
            // here keeps the implementation out of every Application DI file.
            services.AddScoped<
                Planora.BuildingBlocks.Application.Services.IBusinessEventLogger,
                Planora.BuildingBlocks.Infrastructure.Services.BusinessEventLogger>();
            services.AddHttpContextAccessor();
            services.AddScoped<
                Planora.BuildingBlocks.Application.Persistence.ICurrentUserService,
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

            // Raw Redis multiplexer — required by SecurityStampValidator so every
            // JWT-consuming service can honour password-change token revocation.
            // TryAdd: services that register their own multiplexer keep it.
            services.TryAddSingleton<IConnectionMultiplexer>(_ =>
            {
                var options = ConfigurationOptions.Parse(redisConnection);
                options.AbortOnConnectFail = false;
                return ConnectionMultiplexer.Connect(options);
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

            // Single domain event dispatcher: reflection-based, scoped, resolves
            // every registered IDomainEventHandler<TEvent>. The old MediatR-based
            // duplicate in BuildingBlocks.Infrastructure was removed during the
            // convergence audit pass.
            services.AddScoped<
                Planora.BuildingBlocks.Application.Messaging.IDomainEventDispatcher,
                Planora.BuildingBlocks.Infrastructure.Messaging.DomainEventDispatcher>();

            // Deep Health Checks
            var dbConn = configuration.GetConnectionString(dbConnectionStringName ?? "DefaultConnection") 
                ?? configuration.GetConnectionString("DefaultConnection");

            var redisConn = configuration.GetConnectionString("Redis")
                ?? configuration.GetSection("Redis:Configuration").Value;

            var hcBuilder = services.AddHealthChecks();

            if (!string.IsNullOrEmpty(dbConn))
                hcBuilder.AddNpgSql(dbConn, name: "Database", tags: new[] { "db", "postgres" });

            if (!string.IsNullOrEmpty(redisConn))
                hcBuilder.AddRedis(redisConn, name: "Redis", tags: new[] { "cache", "redis" });

            // Broker probe. Reuses the app's own IRabbitMqConnectionManager (registered above) via a
            // custom IHealthCheck instead of the AspNetCore.HealthChecks.RabbitMQ factory, which wants a
            // synchronously-resolvable IConnection that our async connection manager cannot supply without
            // a forbidden blocking wait. Degraded + "messaging" tag: a broker outage surfaces on the
            // aggregate /health (the outbox buffers events meanwhile) without gating readiness/liveness.
            hcBuilder.AddCheck<HealthChecks.RabbitMqHealthCheck>(
                "rabbitmq",
                failureStatus: HealthStatus.Degraded,
                tags: new[] { "messaging" });

            return services;
        }
    }
}
