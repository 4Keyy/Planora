using Planora.BuildingBlocks.Infrastructure.Configuration;
using Planora.BuildingBlocks.Infrastructure.Logging;
using Planora.BuildingBlocks.Infrastructure.Resilience;
using Planora.BuildingBlocks.Infrastructure.Extensions;
using Planora.BuildingBlocks.Infrastructure.Grpc;
using Planora.BuildingBlocks.Infrastructure.Security;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Planora.Realtime.Api.Grpc;
using Planora.Realtime.Api.Hubs;
using Planora.Realtime.Infrastructure.Hubs;
using Planora.Realtime.Application.Handlers;
using Planora.BuildingBlocks.Application.Messaging.Events;
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

        // OpenTelemetry — traces + metrics. No-op when OTEL_EXPORTER_OTLP_ENDPOINT is unset.
        builder.Services.AddPlanoraTelemetry(builder.Configuration, defaultServiceName: "RealtimeService");

        builder.Services.AddControllers();
            builder.Services.AddEndpointsApiExplorer();

            // OpenAPI / Swagger — covers notification controllers; SignalR hubs are not part of the OpenAPI surface.
            builder.Services.AddPlanoraSwaggerGen(
                title: "Planora Realtime API",
                description: "Notification submission and SignalR connection management. The SignalR hub itself is not part of the OpenAPI surface.");

            // gRPC — service-key authentication on inter-service channels
            builder.Services.AddSingleton<ServiceKeyServerInterceptor>();
            builder.Services.AddGrpc(options =>
            {
                options.Interceptors.Add<ServiceKeyServerInterceptor>();
            });

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
                        ClockSkew = TimeSpan.FromSeconds(SecurityConstants.SecurityPolicies.TokenClockSkewSeconds)
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
                        },
                        OnTokenValidated = async context =>
                        {
                            // SECURITY: reject tokens issued before the user's last password change.
                            var redis = context.HttpContext.RequestServices.GetService<IConnectionMultiplexer>();
                            if (await SecurityStampValidator.IsTokenRevokedAsync(redis, context.Principal))
                            {
                                context.Fail("Token revoked by a security event");
                            }
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

            // Raw Redis multiplexer for SecurityStampValidator (password-change token revocation).
            builder.Services.TryAddSingleton<IConnectionMultiplexer>(_ =>
            {
                var redisOptions = ConfigurationOptions.Parse(signalrRedisConnection);
                redisOptions.AbortOnConnectFail = false;
                return ConnectionMultiplexer.Connect(redisOptions);
            });

            // Realtime Infrastructure
            builder.Services.AddRealtimeInfrastructure(builder.Configuration);

            // Rate Limiting
            builder.Services.AddConfiguredRateLimiting(builder.Configuration);

            // Event Handlers
            builder.Services.AddTransient<IIntegrationEventHandler<NotificationEvent>, NotificationEventHandler>();
            // Live data sync — TaskFeedChanged (lists/dashboard) + BranchChanged (open branches).
            builder.Services.AddTransient<IIntegrationEventHandler<RealtimeSyncIntegrationEvent>, RealtimeSyncEventHandler>();

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
                await eventBus.SubscribeAsync<RealtimeSyncIntegrationEvent, RealtimeSyncEventHandler>(app.Lifetime.ApplicationStopping);
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

            // Swagger UI in Development / Staging only
            app.UsePlanoraSwagger(app.Environment, documentTitle: "Planora Realtime API");

            app.MapControllers();
            app.MapGrpcService<RealtimeGrpcService>();
            app.MapHub<NotificationHub>("/hubs/notifications");
            // Health Checks — /health/live, /health/ready, /health (aggregate)
            app.MapPlanoraHealthEndpoints();

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
