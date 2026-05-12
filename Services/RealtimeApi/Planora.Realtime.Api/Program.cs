using Planora.BuildingBlocks.Infrastructure.Logging;
using Planora.BuildingBlocks.Infrastructure.Middleware;
using Planora.BuildingBlocks.Infrastructure.Resilience;
using Planora.BuildingBlocks.Infrastructure.Extensions;
using Planora.Realtime.Api.Grpc;
using Planora.Realtime.Api.Hubs;
using Planora.Realtime.Infrastructure.Hubs;
using Planora.Realtime.Application.Handlers;
using Planora.BuildingBlocks.Infrastructure.Messaging.Events;
using System.Text;
using Serilog;
using Serilog.Events;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.IdentityModel.Tokens;
using StackExchange.Redis;

namespace Planora.Realtime.Api;

public class Program
{
    public static async Task Main(string[] args)
    {
        var builder = WebApplication.CreateBuilder(args);

        // ✨ Enterprise-Grade Unified Serilog Configuration
        builder.ConfigureEnterpriseLogging("realtime-api");

        builder.Services.AddControllers();
            builder.Services.AddEndpointsApiExplorer();
            builder.Services.AddGrpc();

            // JWT
            var jwtSecret = builder.Configuration["JwtSettings:Secret"];
            if (string.IsNullOrEmpty(jwtSecret) || jwtSecret.Length < 32)
                throw new InvalidOperationException("JWT Secret must be at least 32 characters");

            builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
                .AddJwtBearer(options =>
                {
                    options.TokenValidationParameters = new TokenValidationParameters
                    {
                        ValidateIssuer = true,
                        ValidateAudience = true,
                        ValidateLifetime = true,
                        ValidateIssuerSigningKey = true,
                        ValidIssuer = builder.Configuration["JwtSettings:Issuer"],
                        ValidAudience = builder.Configuration["JwtSettings:Audience"],
                        IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtSecret)),
                        ClockSkew = TimeSpan.Zero
                    };

                    // SignalR token from query string
                    options.Events = new JwtBearerEvents
                    {
                        OnMessageReceived = context =>
                        {
                            var accessToken = context.Request.Query["access_token"];
                            var path = context.HttpContext.Request.Path;
                            if (!string.IsNullOrEmpty(accessToken) && path.StartsWithSegments("/hubs"))
                            {
                                context.Token = accessToken;
                            }
                            return Task.CompletedTask;
                        }
                    };
                });
            builder.Services.AddAuthorization();

            // SignalR with Redis backplane (required for multi-instance horizontal scaling)
            var signalrRedisConnection = Environment.GetEnvironmentVariable("REDIS_CONNECTION")
                ?? builder.Configuration["Redis:Configuration"]
                ?? "localhost:6379";
            builder.Services.AddSignalR()
                .AddStackExchangeRedis(signalrRedisConnection, options =>
                    options.Configuration.ChannelPrefix = RedisChannel.Literal("planora"));

            // Realtime Infrastructure
            builder.Services.AddRealtimeInfrastructure(builder.Configuration);

            // Rate Limiting
            builder.Services.AddConfiguredRateLimiting();

            // Event Handlers
            builder.Services.AddTransient<IIntegrationEventHandler<NotificationEvent>, NotificationEventHandler>();

            // Health Checks
            builder.Services.AddHealthChecks();

            var app = builder.Build();

            // ✅ GRACEFUL STARTUP
            using (var scope = app.Services.CreateScope())
            {
                var logger = scope.ServiceProvider.GetRequiredService<ILogger<Program>>();

                // Wait for Redis
                await DependencyWaiter.WaitForRedisAsync(
                    async () =>
                    {
                        var redisConnection = Environment.GetEnvironmentVariable("REDIS_CONNECTION") ?? builder.Configuration["Redis:Configuration"] ?? "redis:6379";
                        var redis = await ConnectionMultiplexer.ConnectAsync(redisConnection);
                        await redis.GetDatabase().PingAsync();
                    },
                    logger,
                    app.Lifetime.ApplicationStopping);

                // Wait for RabbitMQ
                var eventBus = scope.ServiceProvider.GetRequiredService<IEventBus>();
                await DependencyWaiter.WaitForRabbitMqAsync(
                    async () =>
                    {
                        // Test RabbitMQ connection by attempting to ensure connection
                        if (eventBus is RabbitMqEventBus rabbitMqEventBus)
                        {
                            await rabbitMqEventBus.EnsureConnectionAsync(app.Lifetime.ApplicationStopping);
                        }
                    },
                    logger,
                    app.Lifetime.ApplicationStopping);

                // Subscribe to events
                await eventBus.SubscribeAsync<NotificationEvent, NotificationEventHandler>(app.Lifetime.ApplicationStopping);
                logger.LogInformation("✅ RealtimeApi dependencies ready");
            }

            // MIDDLEWARE PIPELINE
            app.ConfigureWebAppLogging();

            // ✨ HTTP Request/Response Logging with Sanitization
            Planora.BuildingBlocks.Infrastructure.Logging.HttpLoggingMiddlewareExtensions.UseHttpLogging(app);

            app.UseCorrelationId();
            app.UseEnhancedGlobalExceptionHandling();

            // Apply rate limiting before other middleware
            app.UseRateLimiter();

            app.UseSecurityHeaders();

            app.UseAuthentication();
            app.UseAuthorization();

            app.MapControllers();
            app.MapGrpcService<RealtimeGrpcService>();
            app.MapHub<NotificationHub>("/hubs/notifications");
            app.MapHealthChecks("/health");

            try
            {
                var appLogger = app.Services.GetRequiredService<ILogger<Program>>();
                appLogger.LogInformation("🚀 RealtimeApi started successfully");
                await app.RunAsync();
            }
            catch (Exception ex)
            {
                Log.Fatal(ex, "❌ RealtimeApi terminated unexpectedly");
                Environment.Exit(1);
            }
            finally
            {
                await Log.CloseAndFlushAsync();
            }
        }
}
