using Planora.ApiGateway.Configuration;
using Planora.ApiGateway.Extensions;
using Planora.BuildingBlocks.Infrastructure.Configuration;
using Planora.BuildingBlocks.Infrastructure.Extensions;
using Planora.BuildingBlocks.Infrastructure.Logging;
using Planora.BuildingBlocks.Infrastructure.Middleware;
using Microsoft.AspNetCore.HttpOverrides;
using System.Net;
using System.Threading.RateLimiting;

namespace Planora.ApiGateway;

public class Program
{
    public static async Task Main(string[] args)
    {
        Log.Logger = new LoggerConfiguration()
            .MinimumLevel.Debug()
            .MinimumLevel.Override("Microsoft.AspNetCore", LogEventLevel.Warning)
            .WriteTo.Console()
            .WriteTo.File("logs/api-gateway-.txt", rollingInterval: RollingInterval.Day)
            .Enrich.FromLogContext()
            .CreateLogger();

        try
        {
            var builder = WebApplication.CreateBuilder(args);

            builder.Host.UseSerilog();

            builder.Configuration
                .SetBasePath(builder.Environment.ContentRootPath)
                .AddJsonFile("appsettings.json", optional: false, reloadOnChange: true)
                .AddJsonFile($"appsettings.{builder.Environment.EnvironmentName}.json", optional: true)
                .AddJsonFile(builder.Environment.IsEnvironment("Docker") ? "ocelot.Docker.json" : "ocelot.json", optional: false, reloadOnChange: true)
                .AddEnvironmentVariables();

            builder.Services.AddApiGatewayServices(builder.Configuration);
            builder.Services.AddOcelotConfiguration(builder.Configuration);
            builder.Services.AddControllers();
            builder.Services.AddHealthChecks();

            // SECURITY: forwarded-header processing is OPT-IN per environment.
            // The gateway sits behind Fly's edge proxy in production; without trusting
            // X-Forwarded-For the rate-limit partition key collapses to the Fly edge
            // IP (one bucket for every user). With unconditional trust, ANY client can
            // spoof X-Forwarded-For: <victim-ip> and bypass the rate limit by
            // poisoning the bucket.
            //
            // Resolution: enable ForwardedHeaders only when at least one KnownProxy is
            // configured. The proxy list is supplied via appsettings or the
            // ForwardedHeaders__KnownProxies environment variable (CIDR-aware
            // entries are still treated as individual IPs here — KnownNetworks is the
            // CIDR-aware alternative when needed). Production deployments must set
            // the Fly edge range; development leaves the section empty and the
            // middleware is not registered.
            var knownProxies = builder.Configuration
                .GetSection("ForwardedHeaders:KnownProxies")
                .Get<string[]>() ?? Array.Empty<string>();
            if (knownProxies.Length > 0)
            {
                builder.Services.Configure<ForwardedHeadersOptions>(options =>
                {
                    options.ForwardedHeaders =
                        ForwardedHeaders.XForwardedFor
                        | ForwardedHeaders.XForwardedProto
                        | ForwardedHeaders.XForwardedHost;
                    options.ForwardLimit = 1;
                    options.KnownProxies.Clear();
                    options.KnownNetworks.Clear();
                    foreach (var proxy in knownProxies)
                    {
                        if (IPAddress.TryParse(proxy, out var parsed))
                        {
                            options.KnownProxies.Add(parsed);
                        }
                    }
                });
            }

            // OpenTelemetry — traces + metrics. No-op when OTEL_EXPORTER_OTLP_ENDPOINT is unset.
            // The gateway is the canonical entrypoint for traceparent propagation — every
            // browser request gets stamped here and the W3C context flows into downstream services.
            builder.Services.AddPlanoraTelemetry(builder.Configuration, defaultServiceName: "ApiGateway");

            // Rate Limiting
            builder.Services.AddRateLimiter(options =>
            {
                options.GlobalLimiter = (PartitionedRateLimiter<HttpContext>)PartitionedRateLimiter.Create<HttpContext, string>(context =>
                    RateLimitPartition.GetFixedWindowLimiter(
                        partitionKey: context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
                        factory: _ => new FixedWindowRateLimiterOptions
                        {
                            AutoReplenishment = true,
                            PermitLimit = 100,
                            Window = TimeSpan.FromMinutes(1)
                        }));

                options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
                options.OnRejected = async (context, _) =>
                {
                    context.HttpContext.Response.StatusCode = StatusCodes.Status429TooManyRequests;
                    context.HttpContext.Response.Headers.RetryAfter = "60";
                    await context.HttpContext.Response.WriteAsJsonAsync(new
                    {
                        error = "Too many requests. Please try again later.",
                        retryAfter = 60
                    });
                };
            });

            // CORS
            builder.Services.AddCors(options =>
            {
                var origins = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>() ?? Array.Empty<string>();
                var devOrigins = origins.Length > 0
                    ? origins
                    : new[] { "http://localhost:3000", "http://127.0.0.1:3000" };

                // SECURITY: Never use AllowAnyOrigin() with AllowCredentials() — browsers reject it.
                // In development we use an explicit list of known local origins.
                // Wildcard origin predicates are removed because they allow attacker-controlled
                // origins, which defeats CORS protection entirely.
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

            // JWT Authentication (local symmetric validation)
            // Validate JWT secret is configured and strong enough before starting
            var jwtSecretConfig = builder.Configuration.GetSection("JwtSettings:Secret").Value;
            if (string.IsNullOrWhiteSpace(jwtSecretConfig) || jwtSecretConfig.Length < 32)
                throw new InvalidOperationException("CRITICAL: JwtSettings:Secret must be at least 32 characters. Set via appsettings.json or JWT_SECRET environment variable.");
            
            builder.Services.AddAuthentication("Bearer")
                .AddJwtBearer("Bearer", options =>
                {
                    var jwtSettings = builder.Configuration.GetSection("JwtSettings");
                    var secret = jwtSettings["Secret"]!; // Already validated above
                    var issuer = jwtSettings["Issuer"] ?? "Planora.Auth";
                    var audience = jwtSettings["Audience"] ?? "Planora.Clients";
                    // SECURITY: Enforce HTTPS in production to prevent token interception
                    options.RequireHttpsMetadata = !builder.Environment.IsDevelopment();
                    options.SaveToken = true;
                    options.TokenValidationParameters = new Microsoft.IdentityModel.Tokens.TokenValidationParameters
                    {
                        ValidateIssuer = true,
                        ValidIssuer = issuer,
                        ValidateAudience = true,
                        ValidAudience = audience,
                        ValidateLifetime = true,
                        ValidateIssuerSigningKey = true,
                        IssuerSigningKey = new Microsoft.IdentityModel.Tokens.SymmetricSecurityKey(System.Text.Encoding.UTF8.GetBytes(secret)),
                        ClockSkew = TimeSpan.FromSeconds(SecurityConstants.SecurityPolicies.TokenClockSkewSeconds)
                    };
                    
                    // Add event handlers for debugging
                    options.Events = new Microsoft.AspNetCore.Authentication.JwtBearer.JwtBearerEvents
                    {
                        OnTokenValidated = context =>
                        {
                            Log.Information("[JWT] Token validated for {UserId}", context.Principal?.FindFirst("sub")?.Value ?? "unknown");
                            return Task.CompletedTask;
                        },
                        OnAuthenticationFailed = context =>
                        {
                            Log.Warning("[JWT] Authentication failed: {ErrorType}", context.Exception.GetType().Name);
                            return Task.CompletedTask;
                        },
                        OnMessageReceived = context =>
                        {
                            // SECURITY: Never log Authorization header or token details - XSS/exposure risk
                            if (context.Request.Headers.ContainsKey("Authorization"))
                            {
                                Log.Debug("[JWT] Bearer token received and will be validated");
                            }
                            return Task.CompletedTask;
                        }
                    };
                });

            builder.Services.AddHealthChecks();

            var app = builder.Build();

            // SECURITY: process X-Forwarded-* BEFORE HTTPS redirection. With this in
            // place HttpsRedirection sees the true client protocol and does not
            // double-redirect HTTPS-terminated edge traffic. UseForwardedHeaders
            // only runs when KnownProxies is non-empty (see Configure above);
            // otherwise it is a no-op safe against header spoofing.
            if (knownProxies.Length > 0)
            {
                app.UseForwardedHeaders();
            }

            // SECURITY: Redirect HTTP to HTTPS in non-development environments.
            if (!builder.Environment.IsDevelopment())
            {
                app.UseHsts();
                app.UseHttpsRedirection();
            }

            // Correlation ID must be first to track all requests
            app.UseMiddleware<Middleware.CorrelationIdMiddleware>();

            // Request logging
            app.UseMiddleware<Middleware.RequestLoggingMiddleware>();

            // Global exception handling - uses EnhancedGlobalExceptionHandlerMiddleware from BuildingBlocks
            // This ensures consistent ProblemDetails responses across all services
            // Passthrough errors from downstream services with proper StatusCode mapping
            app.UseEnhancedGlobalExceptionHandling();

            // Serilog request logging (complementary to our custom middleware)
            app.UseSerilogRequestLogging();

            // CORS - must be before UseOcelot
            var corsPolicy = builder.Environment.IsDevelopment() ? "AllowAll" : "Production";
            app.UseCors(corsPolicy);

            app.UseSecurityHeaders();

            app.UseAuthentication();
            app.UseAuthorization();

            app.UseWhen(ctx => ctx.Request.Path.Equals("/health", StringComparison.OrdinalIgnoreCase), branch =>
            {
                branch.Run(async context =>
                {
                    context.Response.StatusCode = StatusCodes.Status200OK;
                    context.Response.ContentType = "application/json";
                    await context.Response.WriteAsync("{\"status\":\"Healthy\"}");
                });
            });

            // Health Checks — /health/live, /health/ready, /health (aggregate).
            // The UseWhen branch above continues to short-circuit /health with an inline JSON
            // response (so the request never reaches Ocelot proxying); the endpoint
            // registrations published here serve /health/live and /health/ready for orchestrator
            // liveness/readiness probes (Fly.io / k8s).
            app.MapPlanoraHealthEndpoints();

            await app.UseOcelot();

            Log.Information("API Gateway started successfully");
            await app.RunAsync();
        }
        catch (Exception ex)
        {
            Log.Fatal(ex, "API Gateway terminated unexpectedly");
        }
        finally
        {
            Log.CloseAndFlush();
        }
    }
}
