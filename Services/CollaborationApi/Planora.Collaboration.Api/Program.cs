using Planora.BuildingBlocks.Infrastructure;
using Planora.BuildingBlocks.Infrastructure.Configuration;
using Planora.BuildingBlocks.Infrastructure.Extensions;
using Planora.BuildingBlocks.Infrastructure.Filters;
using Planora.BuildingBlocks.Infrastructure.Logging;
using Planora.BuildingBlocks.Infrastructure.Middleware;
using Planora.BuildingBlocks.Infrastructure.Persistence;
using Planora.BuildingBlocks.Infrastructure.Resilience;
using Planora.Collaboration.Application;
using Planora.Collaboration.Infrastructure;
using Planora.Collaboration.Infrastructure.Persistence;
using Planora.BuildingBlocks.Application.Messaging;
using Planora.BuildingBlocks.Application.Messaging.Events;
using Planora.Collaboration.Application.Features.IntegrationEvents;
using StackExchange.Redis;
using Serilog;

namespace Planora.Collaboration.Api
{
    public class Program
    {
        public static async Task Main(string[] args)
        {
            // ✅ Enable HTTP/2 without TLS for the outbound gRPC clients (Todo / Auth) in Docker
            AppContext.SetSwitch("System.Net.Http.SocketsHttpHandler.Http2UnencryptedSupport", true);

            var builder = WebApplication.CreateBuilder(args);

            // ✨ Enterprise-Grade Unified Serilog Configuration
            builder.ConfigureEnterpriseLogging("collaboration-api");

            // OpenTelemetry — traces + metrics. No-op when OTEL_EXPORTER_OTLP_ENDPOINT is unset.
            builder.Services.AddPlanoraTelemetry(builder.Configuration, defaultServiceName: "CollaborationService");

            // Collaboration Application (MediatR behaviors, validators, AutoMapper profiles)
            builder.Services.AddCollaborationApplication();

            // BuildingBlocks Infrastructure (Redis, RabbitMQ, Caching)
            builder.Services.AddBuildingBlocksInfrastructure(builder.Configuration, "CollaborationDatabase");

            // Collaboration Infrastructure (DbContext, Repositories, gRPC clients, Outbox)
            builder.Services.AddCollaborationInfrastructure(builder.Configuration);

            // ✅ JWT Authentication + security-stamp revocation (INV-AUTH-4)
            builder.Services.AddJwtAuthenticationForConsumer(builder.Configuration);

            // API Filters
            builder.Services.AddApiFilters();

            // Response Compression
            builder.Services.AddConfiguredResponseCompression();

            // Rate Limiting
            builder.Services.AddConfiguredRateLimiting(builder.Configuration);

            // CORS
            builder.Services.AddCors(options =>
            {
                var origins = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>() ?? Array.Empty<string>();
                var devOrigins = origins.Length > 0
                    ? origins
                    : ["http://localhost:3000", "http://127.0.0.1:3000"];

                options.AddPolicy("AllowAll", policy =>
                    policy.WithOrigins(devOrigins)
                        .AllowAnyMethod()
                        .AllowAnyHeader()
                        .AllowCredentials());

                options.AddPolicy("Production", policy =>
                    policy.WithOrigins(origins)
                        .AllowAnyMethod()
                        .AllowAnyHeader()
                        .AllowCredentials());
            });

            // Controllers
            builder.Services.AddControllers(options =>
            {
                options.Filters.Add<ResultToActionResultFilter>();
            });

            // OpenAPI / Swagger
            builder.Services.AddPlanoraSwaggerGen(
                title: "Planora Collaboration API",
                description: "Task comment timeline ('ветки'): user, genesis and system comments, plus comment notifications.");

            var app = builder.Build();

            try
            {
                // GRACEFUL STARTUP WITH RETRY
                if (!builder.Environment.IsEnvironment("Testing"))
                using (var scope = app.Services.CreateScope())
                {
                    var provider = scope.ServiceProvider;
                    var logger = provider.GetRequiredService<ILogger<Program>>();

                    // Wait for Database
                    logger.LogInformation("🔄 Waiting for database...");
                    var connectionString = builder.Configuration.GetConnectionString("CollaborationDatabase")!;
                    await DependencyWaiter.WaitForPostgresWithDatabaseCreationAsync(
                        connectionString,
                        "planora_collaboration",
                        logger,
                        app.Lifetime.ApplicationStopping);

                    // Wait for Redis
                    logger.LogInformation("🔄 Waiting for Redis...");
                    await DependencyWaiter.WaitForRedisAsync(
                        async () => await ConnectionMultiplexer.ConnectAsync(
                            builder.Configuration.GetConnectionString("Redis") ?? "localhost:6379"),
                        logger,
                        app.Lifetime.ApplicationStopping);

                    // Apply pending migrations with retry
                    logger.LogInformation("🔄 Checking and applying pending migrations...");
                    var db = provider.GetRequiredService<CollaborationDbContext>();
                    var migrationRetries = 0;
                    const int maxMigrationRetries = 5;

                    while (migrationRetries < maxMigrationRetries)
                    {
                        try
                        {
                            await DatabaseStartup.EnsureReadyAsync(
                                db,
                                logger,
                                app.Lifetime.ApplicationStopping);
                            break;
                        }
                        catch (OperationCanceledException)
                        {
                            throw;
                        }
                        catch (Exception mex)
                        {
                            migrationRetries++;
                            logger.LogError(mex, "❌ Migration attempt {Attempt}/{Max} failed", migrationRetries, maxMigrationRetries);
                            if (migrationRetries >= maxMigrationRetries)
                            {
                                logger.LogCritical("💥 All migration attempts exhausted — service cannot start in broken state");
                                throw;
                            }
                            await Task.Delay(TimeSpan.FromSeconds(5 * migrationRetries), app.Lifetime.ApplicationStopping);
                        }
                    }

                    // Subscribe to Integration Events (Inbox side)
                    logger.LogInformation("🔄 Subscribing to integration events...");
                    var eventBus = provider.GetRequiredService<IEventBus>();

                    await eventBus.SubscribeAsync<TaskCreatedIntegrationEvent, TaskCreatedEventConsumer>(app.Lifetime.ApplicationStopping);
                    logger.LogInformation("✅ Subscribed to TaskCreatedIntegrationEvent");

                    await eventBus.SubscribeAsync<TaskActivityIntegrationEvent, TaskActivityEventConsumer>(app.Lifetime.ApplicationStopping);
                    logger.LogInformation("✅ Subscribed to TaskActivityIntegrationEvent");

                    await eventBus.SubscribeAsync<TaskDeletedIntegrationEvent, TaskDeletedEventConsumer>(app.Lifetime.ApplicationStopping);
                    logger.LogInformation("✅ Subscribed to TaskDeletedIntegrationEvent");

                    await eventBus.SubscribeAsync<SubtaskDeletedIntegrationEvent, SubtaskDeletedEventConsumer>(app.Lifetime.ApplicationStopping);
                    logger.LogInformation("✅ Subscribed to SubtaskDeletedIntegrationEvent");

                    await eventBus.SubscribeAsync<UserDeletedIntegrationEvent, UserDeletedEventConsumer>(app.Lifetime.ApplicationStopping);
                    logger.LogInformation("✅ Subscribed to UserDeletedIntegrationEvent");
                }

                // MIDDLEWARE PIPELINE
                if (!app.Environment.IsProduction())
                {
                    app.UseDeveloperExceptionPage();
                }
                else
                {
                    app.UseExceptionHandler("/error");
                    app.UseHsts();
                }

                app.ConfigureWebAppLogging();

                // ✨ HTTP Request/Response Logging with Sanitization
                Planora.BuildingBlocks.Infrastructure.Logging.HttpLoggingMiddlewareExtensions.UseHttpLogging(app);

                app.UseResponseCompression();
                app.UseCors(app.Environment.IsDevelopment() ? "AllowAll" : "Production");

                // Apply rate limiting before other middleware
                app.UseRateLimiter();

                app.UseCorrelationId();
                app.UseEnhancedGlobalExceptionHandling();

                app.UseSecurityHeaders();

                app.UseAuthentication();
                app.UseAuthorization();

                // Double-submit CSRF check for browser cookie flows. Internal gRPC
                // (application/grpc over HTTP/2) is exempt inside the middleware.
                app.UseCsrfProtection();

                // Swagger UI in Development / Staging only
                app.UsePlanoraSwagger(app.Environment, documentTitle: "Planora Collaboration API");

                // Routes
                app.MapControllers();

                // Health Checks — /health/live, /health/ready, /health (aggregate)
                app.MapPlanoraHealthEndpoints();

                var appLogger = app.Services.GetRequiredService<ILogger<Program>>();
                appLogger.LogInformation("🚀 CollaborationApi started successfully");
                await app.RunAsync();
            }
            catch (Exception ex)
            {
                Log.Fatal(ex, "❌ CollaborationApi terminated unexpectedly");
                Environment.Exit(1);
            }
            finally
            {
                await Log.CloseAndFlushAsync();
            }
        }
    }
}
