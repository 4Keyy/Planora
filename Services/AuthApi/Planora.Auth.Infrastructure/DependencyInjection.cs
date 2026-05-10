using Planora.Auth.Infrastructure.Security;
using Planora.Auth.Infrastructure.Services.Authentication;
using Planora.Auth.Application.Common.Options;
using Planora.Auth.Infrastructure.Services.Common;
using Planora.Auth.Infrastructure.Services.Messaging;
using Planora.Auth.Infrastructure.Services.Security;
using Planora.BuildingBlocks.Infrastructure.Extensions;
using Planora.BuildingBlocks.Infrastructure.Messaging;
using Planora.Auth.Infrastructure.HealthChecks;
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

        return services;
    }

    private static void AddDatabase(IServiceCollection services, IConfiguration configuration)
    {
        var connectionString = configuration.GetConnectionString("AuthDatabase")
            ?? throw new InvalidOperationException("AuthDatabase connection string is not configured");

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

        AddJwtAuthentication(services, configuration);
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
        services.AddGrpc(options =>
        {
            options.EnableDetailedErrors = configuration.GetValue<bool>("Grpc:EnableDetailedErrors", false);
            options.MaxReceiveMessageSize = 4 * 1024 * 1024;
            options.MaxSendMessageSize = 4 * 1024 * 1024;
        });
    }

    private static void AddJwtAuthentication(IServiceCollection services, IConfiguration configuration)
    {
        var jwtSettings = new JwtSettings();
        configuration.GetSection("JwtSettings").Bind(jwtSettings);
        services.Configure<JwtSettings>(configuration.GetSection("JwtSettings"));

        services.AddAuthentication(options =>
        {
            options.DefaultAuthenticateScheme = JwtBearerDefaults.AuthenticationScheme;
            options.DefaultChallengeScheme = JwtBearerDefaults.AuthenticationScheme;
        })
        .AddJwtBearer(options =>
        {
            options.SaveToken = true;
            options.RequireHttpsMetadata = !configuration.GetValue<bool>("IsDevelopment", false);
            options.TokenValidationParameters = new TokenValidationParameters
            {
                ValidateIssuer = true,
                ValidateAudience = true,
                ValidateLifetime = true,
                ValidateIssuerSigningKey = true,
                ValidIssuer = jwtSettings.Issuer,
                ValidAudience = jwtSettings.Audience,
                IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtSettings.Secret)),
                ClockSkew = TimeSpan.FromMinutes(5)
            };
        });

        services.AddAuthorization();
    }

    private static void AddHealthChecks(IServiceCollection services, IConfiguration configuration)
    {
        services.AddHealthChecks()
            .AddDbContextCheck<Persistence.AuthDbContext>("auth-dbcontext")
            .AddRedis(
                configuration.GetConnectionString("Redis")!,
                name: "redis-blacklist",
                failureStatus: HealthStatus.Degraded,
                tags: new[] { "cache", "ready" })
            .AddCheck<RabbitMqHealthCheck>(
                "rabbitmq",
                failureStatus: HealthStatus.Degraded,
                tags: new[] { "messaging" });
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
