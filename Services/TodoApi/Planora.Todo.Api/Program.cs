using Planora.BuildingBlocks.Infrastructure;
using Planora.BuildingBlocks.Infrastructure.Extensions;
using Planora.BuildingBlocks.Infrastructure.Filters;
using Planora.BuildingBlocks.Infrastructure.Logging;
using Planora.BuildingBlocks.Infrastructure.Middleware;
using Planora.BuildingBlocks.Infrastructure.Persistence;
using Planora.BuildingBlocks.Infrastructure.Resilience;
using Planora.Todo.Api.Grpc;
using Planora.Todo.Application;
using Planora.Todo.Infrastructure;
using Planora.Todo.Infrastructure.Persistence;
using Planora.BuildingBlocks.Infrastructure.Messaging;
using Planora.BuildingBlocks.Infrastructure.Messaging.Events;
using Planora.Todo.Application.Features.Todos.Events;
using Planora.Todo.Application.Features.IntegrationEvents;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Npgsql;
using StackExchange.Redis;
using Serilog;

namespace Planora.Todo.Api
{
    public class Program
    {
        public static async Task Main(string[] args)
        {
            // ✅ Enable HTTP/2 without TLS for gRPC in Docker
            AppContext.SetSwitch("System.Net.Http.SocketsHttpHandler.Http2UnencryptedSupport", true);

            var builder = WebApplication.CreateBuilder(args);

            // ✨ Enterprise-Grade Unified Serilog Configuration
            builder.ConfigureEnterpriseLogging("todo-api");

            // Todo Application (MediatR behaviors, validators, AutoMapper profiles)
            builder.Services.AddTodoApplication();

            // BuildingBlocks Infrastructure (Redis, RabbitMQ, Caching)
            builder.Services.AddBuildingBlocksInfrastructure(builder.Configuration, "TodoDatabase");

            // Todo Infrastructure (DbContext, Repositories, Services, JWT)
            builder.Services.AddTodoInfrastructure(builder.Configuration);

            // ✅ JWT Authentication (Критический для защищенных endpoints)
            builder.Services.AddJwtAuthenticationForConsumer(builder.Configuration);

            // API Filters
            builder.Services.AddApiFilters();

            // Response Compression
            builder.Services.AddConfiguredResponseCompression();

            // Rate Limiting
            builder.Services.AddConfiguredRateLimiting();

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

            // gRPC
            builder.Services.AddGrpc();

            // Controllers
            builder.Services.AddControllers(options =>
            {
                options.Filters.Add<ResultToActionResultFilter>();
            });


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
                    var connectionString = builder.Configuration.GetConnectionString("TodoDatabase")!;
                    await DependencyWaiter.WaitForPostgresWithDatabaseCreationAsync(
                        connectionString,
                        "planora_todo",
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
                    var db = provider.GetRequiredService<TodoDbContext>();
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

                    // Subscribe to Integration Events
                    logger.LogInformation("🔄 Subscribing to integration events...");
                    var eventBus = provider.GetRequiredService<IEventBus>();
                    await eventBus.SubscribeAsync<CategoryDeletedIntegrationEvent, CategoryDeletedEventHandler>(app.Lifetime.ApplicationStopping);
                    logger.LogInformation("✅ Subscribed to CategoryDeletedIntegrationEvent");

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

                // Routes
                app.MapControllers();
                app.MapGrpcService<TodoGrpcService>();

                // Health Checks
                app.MapHealthChecks("/health");

                var appLogger = app.Services.GetRequiredService<ILogger<Program>>();
                appLogger.LogInformation("🚀 TodoApi started successfully");
                await app.RunAsync();
            }
            catch (Exception ex)
            {
                Log.Fatal(ex, "❌ TodoApi terminated unexpectedly");
                Environment.Exit(1);
            }
            finally
            {
                await Log.CloseAndFlushAsync();
            }
        }
    }
}
