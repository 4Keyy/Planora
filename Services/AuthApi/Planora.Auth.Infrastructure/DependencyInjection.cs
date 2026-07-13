using Microsoft.AspNetCore.DataProtection;
using Planora.Auth.Infrastructure.Security;
using Planora.Auth.Infrastructure.Services.Authentication;
using Planora.Auth.Application.Common.Options;
using Planora.Auth.Infrastructure.Services.Common;
using Planora.Auth.Infrastructure.Services.Messaging;
using Planora.Auth.Infrastructure.Services.Security;
using Planora.BuildingBlocks.Infrastructure.Configuration;
using Planora.BuildingBlocks.Infrastructure.Extensions;
using Planora.BuildingBlocks.Infrastructure.Grpc;
using Planora.BuildingBlocks.Application.Messaging;
using Planora.BuildingBlocks.Infrastructure.Retention;
using Planora.BuildingBlocks.Infrastructure.Retention.Policies;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.Extensions.Diagnostics.HealthChecks;

namespace Planora.Auth.Infrastructure;

public static class DependencyInjection
{
    public static IServiceCollection AddAuthInfrastructure(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        AddDatabase(services, configuration);
        AddRepositories(services);
        AddAuthenticationServices(services, configuration);
        AddCommonServices(services, configuration);
        AddRedisForTokenBlacklist(services, configuration);
        AddGrpcServices(services, configuration);
        AddHealthChecks(services, configuration);
        AddRabbitMqBackground(services, configuration);

        // Retention: purge long-expired refresh tokens (token rotation never removes old rows) plus the
        // processed outbox rows. Safety-gated (advisory lock + tripwire + dry-run), disabled by default.
        services.AddRetention(configuration)
            .AddRetentionPolicy<ProcessedMessagePurgePolicy>()
            .AddRetentionPolicy<Retention.ExpiredRefreshTokenPurgePolicy>()
            .AddRetentionPolicy<Retention.UsedRecoveryCodePurgePolicy>()
            .AddRetentionPolicy<Retention.FriendshipTerminalPurgePolicy>()
            .AddRetentionPolicy<Retention.LoginHistoryPurgePolicy>()
            .AddRetentionPolicy<Retention.AuditLogPurgePolicy>();

        return services;
    }

    private static void AddDatabase(IServiceCollection services, IConfiguration configuration)
    {
        var connectionString = configuration.GetConnectionString("AuthDatabase")
            ?? throw new InvalidOperationException("AuthDatabase connection string is not configured");

        var dataProtection = services.AddDataProtection()
            .SetApplicationName("Planora.Auth");

        // SECURITY: persist the Data Protection key ring to Redis. Without a shared
        // store the key ring is container-ephemeral, so every restart would make
        // existing encrypted TOTP secrets undecryptable and lock 2FA users out.
        var redisForKeys = configuration.GetConnectionString("Redis");
        if (!string.IsNullOrWhiteSpace(redisForKeys))
        {
            var keyRingOptions = ConfigurationOptions.Parse(redisForKeys);
            keyRingOptions.AbortOnConnectFail = false;
            dataProtection.PersistKeysToStackExchangeRedis(
                ConnectionMultiplexer.Connect(keyRingOptions),
                "Planora:Auth:DataProtection-Keys");
        }

        services.AddDbContext<AuthDbContext>(options =>
        {
            options.UseNpgsql(connectionString, npgsqlOptions =>
            {
                npgsqlOptions.EnableRetryOnFailure(
                    maxRetryCount: 5,
                    maxRetryDelay: TimeSpan.FromSeconds(30),
                    errorCodesToAdd: null);
                npgsqlOptions.CommandTimeout(30);
            });
        });

        services.AddScoped<IApplicationDbContext>(sp => sp.GetRequiredService<AuthDbContext>());

        // Expose the context as DbContext too, so the retention background service can resolve it the
        // same way every other service does (Auth otherwise only registers IApplicationDbContext).
        services.AddScoped<Microsoft.EntityFrameworkCore.DbContext>(sp => sp.GetRequiredService<AuthDbContext>());
    }

    private static void AddRepositories(IServiceCollection services)
    {
        services.AddScoped<IAuthUnitOfWork, AuthUnitOfWork>();
        services.AddScoped<IUserRepository, UserRepository>();
        services.AddScoped<IFriendshipRepository, FriendshipRepository>();
        services.AddScoped<IRefreshTokenRepository, RefreshTokenRepository>();
        services.AddScoped<ILoginHistoryRepository, LoginHistoryRepository>();
        services.AddScoped<IPasswordHistoryRepository, PasswordHistoryRepository>();
    }

    private static void AddAuthenticationServices(IServiceCollection services, IConfiguration configuration)
    {
        services.AddHttpClient();
        services.AddScoped<ITokenService, TokenService>();
        services.AddScoped<IPasswordHasher, PasswordHasher>();
        services.AddScoped<IPasswordValidator, PasswordValidator>();
        services.AddScoped<IPasswordResetTokenService, PasswordResetTokenService>();
        services.AddScoped<ITwoFactorService, TwoFactorService>();
        services.AddScoped<ITokenBlacklistService, TokenBlacklistService>();
        services.AddScoped<ISecurityStampService, SecurityStampService>();
        services.AddScoped<IRecoveryCodeService, RecoveryCodeService>();

        AddJwtAuthentication(services, configuration);
    }

    // Detects development mode from configuration key "IsDevelopment" (explicit override,
    // used in tests and local docker overrides) and falls back to ASPNETCORE_ENVIRONMENT.
    private static bool IsDevelopmentEnvironment(IConfiguration? configuration = null)
    {
        if (configuration is not null
            && bool.TryParse(configuration["IsDevelopment"], out var configFlag))
            return configFlag;

        var env = Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT") ?? string.Empty;
        return env.Equals("Development", StringComparison.OrdinalIgnoreCase);
    }

    private static void AddCommonServices(IServiceCollection services, IConfiguration configuration)
    {
        services.Configure<FrontendOptions>(
            configuration.GetSection(FrontendOptions.SectionName));
        services.Configure<EmailOptions>(
            configuration.GetSection(EmailOptions.SectionName));

        services.AddHttpContextAccessor();
        services.AddScoped<ICurrentUserService, CurrentUserService>();
        services.AddScoped<IDateTime, DateTimeService>();
        services.AddScoped<IFileStorageService, LocalFileStorageService>();
        services.AddScoped<IImageProcessor, ImageSharpImageProcessor>();
        services.AddScoped<IAvatarStorage, LocalAvatarStorage>();
        services.AddSingleton<IAvatarMetrics, AvatarMetrics>();
        services.AddScoped<IEmailMessageSender, SmtpEmailMessageSender>();
        services.AddScoped<IEmailService, EmailService>();
    }

    private static void AddRedisForTokenBlacklist(IServiceCollection services, IConfiguration configuration)
    {
        var redisConnectionString = configuration.GetConnectionString("Redis");

        services.AddSingleton<IConnectionMultiplexer>(sp =>
        {
            var configOptions = ConfigurationOptions.Parse(redisConnectionString!);
            configOptions.AbortOnConnectFail = false;
            configOptions.ConnectTimeout = 5000;
            configOptions.SyncTimeout = 5000;
            return ConnectionMultiplexer.Connect(configOptions);
        });

        services.AddStackExchangeRedisCache(options =>
        {
            options.Configuration = redisConnectionString;
            options.InstanceName = "PlanoraAuth:TokenBlacklist:";
        });
    }

    private static void AddGrpcServices(IServiceCollection services, IConfiguration configuration)
    {
        services.AddSingleton<ServiceKeyServerInterceptor>();
        services.AddGrpc(options =>
        {
            options.EnableDetailedErrors = configuration.GetValue<bool>("Grpc:EnableDetailedErrors", false);
            options.MaxReceiveMessageSize = 4 * 1024 * 1024;
            options.MaxSendMessageSize = 4 * 1024 * 1024;
            options.Interceptors.Add<ServiceKeyServerInterceptor>();
        });
    }

    private static void AddJwtAuthentication(IServiceCollection services, IConfiguration configuration)
    {
        var jwtSettings = new JwtSettings();
        configuration.GetSection("JwtSettings").Bind(jwtSettings);
        if (string.IsNullOrWhiteSpace(jwtSettings.Secret) || jwtSettings.Secret.Length < 32)
            throw new InvalidOperationException("JwtSettings:Secret must be at least 32 characters long.");
        services.Configure<JwtSettings>(configuration.GetSection("JwtSettings"));

        services.AddAuthentication(options =>
        {
            options.DefaultAuthenticateScheme = JwtBearerDefaults.AuthenticationScheme;
            options.DefaultChallengeScheme = JwtBearerDefaults.AuthenticationScheme;
        })
        .AddJwtBearer(options =>
        {
            options.SaveToken = true;
            options.RequireHttpsMetadata = !IsDevelopmentEnvironment(configuration);
            options.TokenValidationParameters = new TokenValidationParameters
            {
                ValidateIssuer = true,
                ValidateAudience = true,
                ValidateLifetime = true,
                ValidateIssuerSigningKey = true,
                ValidIssuer = jwtSettings.Issuer,
                ValidAudience = jwtSettings.Audience,
                IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtSettings.Secret)),
                ClockSkew = TimeSpan.FromSeconds(SecurityConstants.SecurityPolicies.TokenClockSkewSeconds),
                RequireExpirationTime = true
            };

            // SECURITY: enforce the per-user security stamp on every authenticated Auth API
            // request. Without this hook, access tokens issued before a password change,
            // 2FA disable, revoke-all-sessions, account delete, or email change would
            // continue to work against Auth itself until they expired naturally — defeating
            // the whole purpose of rotating the stamp. Consumer services (Todo, Category,
            // Messaging, Realtime) already enforce this via AddJwtAuthenticationForConsumer;
            // Auth API must enforce it equally on its own surface.
            options.Events = new Microsoft.AspNetCore.Authentication.JwtBearer.JwtBearerEvents
            {
                OnTokenValidated = async context =>
                {
                    var redis = context.HttpContext.RequestServices
                        .GetService<StackExchange.Redis.IConnectionMultiplexer>();
                    if (await Planora.BuildingBlocks.Infrastructure.Security
                        .SecurityStampValidator.IsTokenRevokedAsync(redis, context.Principal))
                    {
                        context.Fail("Token revoked by a security event");
                    }
                },
            };
        });

        services.AddAuthorization();
    }

    private static void AddHealthChecks(IServiceCollection services, IConfiguration configuration)
    {
        // The broker (rabbitmq) check is registered once for every service in
        // AddBuildingBlocksInfrastructure; Auth must not add a second one under the same name.
        services.AddHealthChecks()
            .AddDbContextCheck<Persistence.AuthDbContext>("auth-dbcontext")
            .AddRedis(
                configuration.GetConnectionString("Redis")!,
                name: "redis-blacklist",
                failureStatus: HealthStatus.Degraded,
                tags: new[] { "cache", "ready" });
    }

    private static void AddRabbitMqBackground(IServiceCollection services, IConfiguration configuration)
    {
        services.AddSingleton<IRabbitMqConnectionManager>(sp =>
        {
            var logger = sp.GetRequiredService<ILogger<RabbitMqConnectionManager>>();
            return new RabbitMqConnectionManager(configuration, logger);
        });

        services.AddHostedService<RabbitMqStartupHostedService>();
    }
}
