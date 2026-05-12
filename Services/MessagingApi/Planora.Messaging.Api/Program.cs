using Planora.BuildingBlocks.Infrastructure;
using Planora.BuildingBlocks.Infrastructure.Extensions;
using Planora.BuildingBlocks.Infrastructure.Filters;
using Planora.BuildingBlocks.Infrastructure.Logging;
using Planora.BuildingBlocks.Infrastructure.Middleware;
using Planora.BuildingBlocks.Infrastructure.Persistence;
using Planora.BuildingBlocks.Infrastructure.Resilience;
using StackExchange.Redis;
using Planora.Messaging.Api.Grpc;
using Planora.Messaging.Application;
using Planora.Messaging.Infrastructure.Persistence;
using Serilog;
using Serilog.Events;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.IdentityModel.Tokens;
using System.IdentityModel.Tokens.Jwt;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Npgsql;

namespace Planora.Messaging.Api
{
    public class Program
    {
        public static async Task Main(string[] args)
        {
            var builder = WebApplication.CreateBuilder(args);

            // ✨ Enterprise-Grade Unified Serilog Configuration
            builder.ConfigureEnterpriseLogging("messaging-api");

            builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
                .AddJwtBearer(options =>
                {
                    var secret = builder.Configuration["JwtSettings:Secret"];
                    if (string.IsNullOrWhiteSpace(secret) || secret.Length < 32)
                        throw new InvalidOperationException("JwtSettings:Secret must be at least 32 characters long.");
                    var issuer = builder.Configuration["JwtSettings:Issuer"];
                    var audience = builder.Configuration["JwtSettings:Audience"];
                    options.RequireHttpsMetadata = !builder.Environment.IsDevelopment();
                    options.TokenValidationParameters = new TokenValidationParameters
                    {
                        ValidateIssuer = true,
                        ValidIssuer = issuer,
                        ValidateAudience = true,
                        ValidAudience = audience,
                        ValidateLifetime = true,
                        ValidateIssuerSigningKey = true,
                        IssuerSigningKey = new SymmetricSecurityKey(System.Text.Encoding.UTF8.GetBytes(secret!)),
                        ClockSkew = TimeSpan.Zero,
                        NameClaimType = "sub"
                    };
                });

            builder.Services.AddAuthorization();

            // Messaging Application (MediatR behaviors, validators, AutoMapper profiles)
            builder.Services.AddMessagingApplication();

            // BuildingBlocks Infrastructure (Redis, RabbitMQ, Caching)
            builder.Services.AddBuildingBlocksInfrastructure(builder.Configuration, "MessagingDatabase");

            // Messaging Infrastructure (DbContext, Repositories, Services, JWT)
            builder.Services.AddMessagingInfrastructure(builder.Configuration);

            // JWT already configured above (lines 31-48) - do not duplicate

            // API Filters
            builder.Services.AddApiFilters();

            // Response Compression
            builder.Services.AddConfiguredResponseCompression();

            // Rate Limiting
            builder.Services.AddConfiguredRateLimiting();

            // CORS — always use explicit origin list; AllowAnyOrigin is incompatible with withCredentials
            builder.Services.AddCors(options =>
            {
                var origins = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>() ?? Array.Empty<string>();
                options.AddPolicy("AllowConfigured", policy =>
                    policy.WithOrigins(origins)
                        .AllowAnyMethod()
                        .AllowAnyHeader()
                        .AllowCredentials());
            });

            // gRPC
            builder.Services.AddGrpc(options =>
            {
                options.EnableDetailedErrors = builder.Configuration.GetValue<bool>("Grpc:EnableDetailedErrors", false);
                options.MaxReceiveMessageSize = 4 * 1024 * 1024;
                options.MaxSendMessageSize = 4 * 1024 * 1024;
            });

            // Controllers
            builder.Services.AddControllers(options =>
            {
                options.Filters.Add<ResultToActionResultFilter>();
            });


            var app = builder.Build();

            try
            {
                // GRACEFUL STARTUP WITH RETRY
                using (var scope = app.Services.CreateScope())
                {
                    var provider = scope.ServiceProvider;
                    var logger = provider.GetRequiredService<ILogger<Program>>();

                    // Wait for Database
                    logger.LogInformation("🔄 Waiting for database...");
                    var connectionString = builder.Configuration.GetConnectionString("MessagingDatabase")!;
                    await DependencyWaiter.WaitForPostgresWithDatabaseCreationAsync(
                        connectionString,
                        "planora_messaging",
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
                    var db = provider.GetRequiredService<MessagingDbContext>();
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
                app.UseCors("AllowConfigured");

                // Apply rate limiting before other middleware
                app.UseRateLimiter();

                app.UseCorrelationId();
                app.UseEnhancedGlobalExceptionHandling();

                app.UseSecurityHeaders();

                app.UseAuthentication();
                app.UseAuthorization();

                // Routes
                app.MapControllers();
                app.MapGrpcService<MessagingGrpcService>();

                // Health Checks
                app.MapHealthChecks("/health");

                var appLogger = app.Services.GetRequiredService<ILogger<Program>>();
                appLogger.LogInformation("🚀 MessagingApi started successfully");
                await app.RunAsync();
            }
            catch (Exception ex)
            {
                Log.Fatal(ex, "❌ MessagingApi terminated unexpectedly");
                Environment.Exit(1);
            }
            finally
            {
                await Log.CloseAndFlushAsync();
            }
        }
    }
}
