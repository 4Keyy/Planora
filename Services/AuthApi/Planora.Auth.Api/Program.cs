using Planora.Auth.Api.Configuration;
using Planora.Auth.Api.Filters;
using Planora.Auth.Application;
using Planora.BuildingBlocks.Infrastructure;
using Planora.BuildingBlocks.Infrastructure.Logging;
using Planora.BuildingBlocks.Infrastructure.Filters;
using Planora.BuildingBlocks.Infrastructure.Persistence;
using Planora.BuildingBlocks.Infrastructure.Resilience;
using Planora.BuildingBlocks.Infrastructure.Extensions;
using Planora.BuildingBlocks.Infrastructure.Middleware;
using Serilog;
using Serilog.Events;
using Npgsql;
using StackExchange.Redis;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Microsoft.AspNetCore.Server.Kestrel.Core;

namespace Planora.Auth.Api
{
    public class Program
    {
        public static async Task Main(string[] args)
        {
            var builder = WebApplication.CreateBuilder(args);

            // ✨ Enterprise-Grade Unified Serilog Configuration
            builder.ConfigureEnterpriseLogging("auth-api");

            // Auth Application (MediatR behaviors, validators, AutoMapper profiles)
            builder.Services.AddAuthApplication();

            // BuildingBlocks Infrastructure (Redis, RabbitMQ, Caching)
            builder.Services.AddBuildingBlocksInfrastructure(builder.Configuration, "AuthDatabase");

            // Auth Infrastructure & Domain
            builder.Services.AddAuthInfrastructure(builder.Configuration);

            // API Filters
            builder.Services.AddApiFilters();

            // Response Compression
            builder.Services.AddConfiguredResponseCompression();

            // Rate Limiting
            builder.Services.AddConfiguredRateLimiting();

            // OpenTelemetry
            builder.Services.AddOpenTelemetryConfiguration(builder.Configuration);

            builder.Services.Configure<Microsoft.AspNetCore.Builder.ForwardedHeadersOptions>(options =>
            {
                options.ForwardedHeaders =
                    Microsoft.AspNetCore.HttpOverrides.ForwardedHeaders.XForwardedFor
                    | Microsoft.AspNetCore.HttpOverrides.ForwardedHeaders.XForwardedProto
                    | Microsoft.AspNetCore.HttpOverrides.ForwardedHeaders.XForwardedHost;
                options.ForwardLimit = 1;

                foreach (var proxy in builder.Configuration.GetSection("ForwardedHeaders:KnownProxies").Get<string[]>() ?? [])
                {
                    if (System.Net.IPAddress.TryParse(proxy, out var address))
                    {
                        options.KnownProxies.Add(address);
                    }
                }
            });

            // Swagger/OpenAPI
            builder.Services.AddSwaggerDocumentation();

            // CORS
            builder.Services.AddCors(options =>
            {
                var origins = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>() ?? Array.Empty<string>();

                // Development policy: allow configured local origins only (not wildcard).
                // AllowCredentials() is required for the httpOnly cookie to be sent cross-origin.
                // SECURITY: Never use AllowAnyOrigin() with AllowCredentials() — browsers block it.
                options.AddPolicy("AllowAll", policy =>
                    policy.WithOrigins(origins.Length > 0 ? origins : ["http://localhost:3000", "http://127.0.0.1:3000"])
                        .AllowAnyMethod()
                        .AllowAnyHeader()
                        .AllowCredentials());

                // Production policy: explicit origin list, credentials required for cookie flow.
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
                options.Filters.Add<TokenBlacklistFilter>();
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

                    var handlerCheck = provider.GetService<
                        MediatR.IRequestHandler<
                            Planora.Auth.Application.Features.Authentication.Commands.Register.RegisterCommand,
                        Planora.BuildingBlocks.Domain.Result<Planora.Auth.Application.Features.Authentication.Response.Register.RegisterResponse>>>();
                    logger.LogInformation("RegisterCommand handler DI check: {Status}", handlerCheck == null ? "missing" : "present");

                    // Wait for Database
                    logger.LogInformation("🔄 Waiting for database...");
                    var connectionString = builder.Configuration.GetConnectionString("AuthDatabase")!;
                    await DependencyWaiter.WaitForPostgresWithDatabaseCreationAsync(
                        connectionString,
                        "planora_auth_db",
                        logger,
                        app.Lifetime.ApplicationStopping);

                    // Wait for Redis
                    logger.LogInformation("🔄 Waiting for Redis...");
                    try
                    {
                        await DependencyWaiter.WaitForRedisAsync(
                            async () => await ConnectionMultiplexer.ConnectAsync(
                                builder.Configuration.GetConnectionString("Redis") ?? "localhost:6379"),
                            logger,
                            app.Lifetime.ApplicationStopping);
                    }
                    catch (Exception ex)
                    {
                        logger.LogWarning(ex, "⚠️ Redis not available, continuing without Redis");
                    }

                    // RabbitMQ is optional at startup: handled by background service

                    // Apply pending migrations with retry
                    logger.LogInformation("🔄 Checking and applying pending migrations...");
                    var db = provider.GetRequiredService<Planora.Auth.Infrastructure.Persistence.AuthDbContext>();
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
                app.UseForwardedHeaders();

                if (!app.Environment.IsProduction())
                {
                    app.UseDeveloperExceptionPage();
                }
                else
                {
                    app.UseExceptionHandler("/error");
                    // SECURITY: HSTS tells browsers to always use HTTPS for this domain.
                    // max-age=31536000 (1 year) with includeSubDomains and preload.
                    app.UseHsts();
                }

                // SECURITY: Redirect all HTTP requests to HTTPS in non-development environments.
                // Development uses HTTP for local tooling convenience, but staging/production
                // must enforce HTTPS at the application layer in addition to infrastructure.
                if (!app.Environment.IsDevelopment())
                {
                    app.UseHttpsRedirection();
                }

                app.ConfigureWebAppLogging();

                // HTTP Request/Response Logging with Sanitization
                Planora.BuildingBlocks.Infrastructure.Logging.HttpLoggingMiddlewareExtensions.UseHttpLogging(app);

                app.UseResponseCompression();
                app.UseCors(app.Environment.IsDevelopment() ? "AllowAll" : "Production");

                // Apply rate limiting before other middleware
                app.UseRateLimiter();

                app.UseCorrelationId();
                app.UseEnhancedGlobalExceptionHandling();

                if (app.Environment.IsDevelopment() || app.Environment.IsStaging())
                {
                    app.UseSwaggerDocumentation(app.Environment);
                }

                // SECURITY: Add security headers via shared middleware (SecurityHeadersMiddleware).
                // This replaces the previous inline lambda that included `style-src 'unsafe-inline'`
                // in the CSP, which was weaker than necessary for a JSON API service.
                app.UseSecurityHeaders();

                app.UseAuthentication();
                app.UseAuthorization();

                // SECURITY: Enforce CSRF double-submit cookie validation on all state-modifying
                // requests (POST, PUT, DELETE, PATCH) that are not public auth endpoints.
                app.UseCsrfProtection();

                // Routes
                app.MapControllers();
                app.MapGrpcService<Planora.Auth.Api.Grpc.AuthGrpcService>();

                // Health Checks
                app.MapHealthChecks("/health");

                var appLogger = app.Services.GetRequiredService<ILogger<Program>>();
                appLogger.LogInformation("🚀 AuthApi started successfully");
                await app.RunAsync();
            }
            catch (Exception ex)
            {
                Log.Fatal(ex, "Application terminated unexpectedly");
                Environment.Exit(1);
            }
            finally
            {
                Log.CloseAndFlush();
            }
        }
    }
}
