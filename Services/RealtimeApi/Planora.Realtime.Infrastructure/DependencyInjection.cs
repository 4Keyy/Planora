using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Planora.BuildingBlocks.Application.Messaging;
using Planora.BuildingBlocks.Application.Outbox;
using Planora.BuildingBlocks.Domain.Interfaces;
using Planora.BuildingBlocks.Infrastructure.Grpc;
using Planora.BuildingBlocks.Infrastructure.HealthChecks;
using Planora.BuildingBlocks.Infrastructure.Persistence;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Planora.Realtime.Application.Handlers;
using Planora.Realtime.Application.Interfaces;
using Planora.Realtime.Infrastructure.Grpc;
using Planora.Realtime.Infrastructure.Persistence;
using Planora.Realtime.Infrastructure.Services;
using Planora.Realtime.Application.Features.IntegrationEvents;
using Planora.BuildingBlocks.Infrastructure.Retention;
using Planora.BuildingBlocks.Infrastructure.Retention.Policies;

namespace Planora.Realtime.Infrastructure;

public static class DependencyInjection
{
    public static IServiceCollection AddRealtimeInfrastructure(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        services.AddSingleton<IConnectionManager, ConnectionManager>();
        services.AddSingleton<INotificationService, NotificationService>();

        // Live data-sync fan-out over SignalR (TaskFeedChanged / BranchChanged). Singleton like
        // NotificationService — it only holds the hub context, which is itself a singleton.
        services.AddSingleton<IRealtimeBroadcaster, RealtimeBroadcaster>();

        // Branch-room join authorization → TodoApi gRPC. The x-service-key header is added by the
        // shared interceptor (INV-COMM-2); the URL mirrors the Collaboration service's wiring.
        services.AddSingleton<ServiceKeyClientInterceptor>();
        var todoGrpcUrl = configuration["GrpcServices:TodoApi"]
            ?? configuration["Services:Todo:Url"]
            ?? "http://localhost:5101";
        services.AddGrpcClient<Planora.GrpcContracts.TodoService.TodoServiceClient>(o =>
                o.Address = new Uri(todoGrpcUrl))
            .AddInterceptor<ServiceKeyClientInterceptor>();
        services.AddScoped<ITaskBranchAuthorizer, TaskBranchAuthorizer>();

        services.AddSingleton<IRabbitMqConnectionManager>(sp =>
        {
            var logger = sp.GetRequiredService<ILogger<RabbitMqConnectionManager>>();
            return new RabbitMqConnectionManager(configuration, logger);
        });

        services.AddSingleton<IEventBus>(sp =>
        {
            var connectionManager = sp.GetRequiredService<IRabbitMqConnectionManager>();
            var logger = sp.GetRequiredService<ILogger<RabbitMqEventBus>>();
            var serviceProvider = sp;

            return new RabbitMqEventBus(connectionManager, logger, serviceProvider);
        });

        // Broker probe. Realtime does not call AddBuildingBlocksInfrastructure (it wires messaging by
        // hand above), so it registers the same shared RabbitMqHealthCheck itself — Degraded + "messaging"
        // surfaces a broker outage on the aggregate /health without gating readiness/liveness. As a
        // consumer of NotificationEvent/RealtimeSyncIntegrationEvent, its broker link is operationally
        // load-bearing, so this visibility matters.
        services.AddHealthChecks()
            .AddCheck<RabbitMqHealthCheck>(
                "rabbitmq",
                failureStatus: HealthStatus.Degraded,
                tags: new[] { "messaging" });

        // Integration-event handlers, registered by their CONCRETE type. This is load-bearing:
        // RabbitMqEventBus resolves the handler via GetService(typeof(THandler)) — the concrete type
        // captured at SubscribeAsync<TEvent, THandler> — NOT via its IIntegrationEventHandler<T>
        // interface. An interface-only registration leaves GetService(concreteType) returning null,
        // so the bus logs "Handler ... could not be resolved", skips it and STILL ACKs the message:
        // every NotificationEvent / RealtimeSyncIntegrationEvent is then silently dropped — nothing is
        // persisted to the notification log and nothing is pushed over SignalR. Scoped because the
        // handlers depend on the scoped INotificationStore and the bus opens a scope per delivery.
        // Mirrors how every sibling service registers its consumers (e.g. AddScoped<UserDeletedEventConsumer>()).
        services.AddScoped<NotificationEventHandler>();
        services.AddScoped<RealtimeSyncEventHandler>();

        // Cascade cleanup of the notification log when a task or user is deleted upstream. Same concrete-
        // type registration requirement as above (the bus resolves the concrete handler). They depend on
        // INotificationStore, which degrades to a no-op when no database is configured.
        services.AddScoped<TaskDeletedNotificationCleanupHandler>();
        services.AddScoped<UserDeletedNotificationCleanupHandler>();

        // T2.5 — durable notification log. Wired conditionally on a configured
        // connection string so test hosts and ephemeral local runs (which don't
        // yet provide a Postgres) keep starting without the DB dependency.
        // Production wiring (docker-compose, Fly) sets ConnectionStrings__RealtimeDatabase.
        var connectionString = configuration.GetConnectionString("RealtimeDatabase");
        if (!string.IsNullOrWhiteSpace(connectionString))
        {
            // RealtimeDbContext takes IDomainEventDispatcher in its constructor for
            // parity with sister DbContexts. Realtime's entities (Notification,
            // NotificationDelivery, OutboxMessage) emit zero domain events today —
            // they are server-managed audit rows, not aggregates with behaviour —
            // so a no-op dispatcher is the correct registration. `TryAddScoped`
            // is intentional: if a future commit calls `AddBuildingBlocksInfrastructure`
            // from `Program.cs` (which registers the reflection-based real
            // dispatcher), the Try-form here lets that registration win without
            // a manual `Replace` step.
            services.TryAddScoped<IDomainEventDispatcher, NoOpDomainEventDispatcher>();

            services.AddDbContext<RealtimeDbContext>(options =>
                options.UseNpgsql(connectionString, npgsqlOptions =>
                {
                    npgsqlOptions.EnableRetryOnFailure(
                        maxRetryCount: 5,
                        maxRetryDelay: TimeSpan.FromSeconds(30),
                        errorCodesToAdd: null);
                    npgsqlOptions.CommandTimeout(30);
                }));

            // Register RealtimeDbContext as DbContext so the canonical OutboxProcessor
            // (and the canonical OutboxRepository<TContext> below) can resolve it
            // without an extra service-specific binding.
            services.AddScoped<DbContext>(sp => sp.GetRequiredService<RealtimeDbContext>());

            // Canonical outbox repository (T2.3). No per-service duplicate exists for
            // Realtime — the abstraction lands once here.
            services.AddScoped<IOutboxRepository, OutboxRepository<RealtimeDbContext>>();

            // Durable notification log (write + read sides). Registered only when a database is
            // configured; the TryAdd fallbacks below cover the no-DB case.
            services.AddScoped<INotificationStore, NotificationStore>();
            services.AddScoped<INotificationReadStore, NotificationReadStore>();

            services.AddHealthChecks()
                .AddDbContextCheck<RealtimeDbContext>("realtime-dbcontext");

            // Retention: notification-log housekeeping (read 3d / unread 90d / deliveries 30d) plus the
            // processed outbox purge. Registered only when a database is configured; safety-gated
            // (advisory lock + tripwire + dry-run) and disabled by default.
            services.AddRetention(configuration)
                .AddRetentionPolicy<ProcessedMessagePurgePolicy>()
                .AddRetentionPolicy<Retention.ReadNotificationPurgePolicy>()
                .AddRetentionPolicy<Retention.UnreadNotificationPurgePolicy>()
                .AddRetentionPolicy<Retention.NotificationDeliveryPurgePolicy>();
        }

        // No-DB fallbacks (test hosts / ephemeral local runs): the consumer still pushes ephemerally
        // and the read API degrades to empty rather than failing to resolve.
        services.TryAddScoped<INotificationStore, NullNotificationStore>();
        services.TryAddScoped<INotificationReadStore, NullNotificationReadStore>();

        return services;
    }

    private sealed class NoOpDomainEventDispatcher : IDomainEventDispatcher
    {
        public Task DispatchAsync(IDomainEvent domainEvent, CancellationToken cancellationToken = default)
            => Task.CompletedTask;

        public Task DispatchAsync(IEnumerable<IDomainEvent> domainEvents, CancellationToken cancellationToken = default)
            => Task.CompletedTask;
    }
}
