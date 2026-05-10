namespace Planora.BuildingBlocks.Infrastructure.Configuration;

/// <summary>
/// Configuration validation utility to ensure critical settings are configured before startup.
/// Helps prevent runtime errors from missing or incomplete configuration.
/// </summary>
public static class ConfigurationValidator
{
    /// <summary>
    /// Validates that all required JWT settings are configured.
    /// Throws InvalidOperationException if any required setting is missing.
    /// </summary>
    public static void ValidateJwtSettings(IConfiguration configuration)
    {
        var jwtSection = configuration.GetSection("JwtSettings");
        
        ValidateConfigurationValue(jwtSection, "Secret", "JWT_SECRET", minLength: 32);
        ValidateConfigurationValue(jwtSection, "Issuer", "JWT_ISSUER");
        ValidateConfigurationValue(jwtSection, "Audience", "JWT_AUDIENCE");
    }

    /// <summary>
    /// Validates that database connection string is configured.
    /// Throws InvalidOperationException if connection string is missing.
    /// </summary>
    public static void ValidateDatabaseConnection(IConfiguration configuration, string connectionStringKey)
    {
        var connectionString = configuration.GetConnectionString(connectionStringKey);
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            throw new InvalidOperationException(
                $"CRITICAL: Connection string '{connectionStringKey}' must be configured. " +
                $"Set via appsettings.json or environment variable ConnectionStrings__{connectionStringKey}");
        }
    }

    /// <summary>
    /// Validates that Redis configuration is present.
    /// </summary>
    public static void ValidateRedisConfiguration(IConfiguration configuration)
    {
        var redisConfig = configuration.GetSection("Redis:Configuration").Value;
        if (string.IsNullOrWhiteSpace(redisConfig))
        {
            throw new InvalidOperationException(
                "CRITICAL: Redis:Configuration must be configured. " +
                "Set via appsettings.json or REDIS_CONNECTION environment variable");
        }
    }

    /// <summary>
    /// Validates that RabbitMQ configuration is present.
    /// </summary>
    public static void ValidateRabbitMqConfiguration(IConfiguration configuration)
    {
        var rabbitMqSection = configuration.GetSection("RabbitMq");
        ValidateConfigurationValue(rabbitMqSection, "HostName", "RABBITMQ_HOST");
        ValidateConfigurationValue(rabbitMqSection, "UserName", "RABBITMQ_USER");
        ValidateConfigurationValue(rabbitMqSection, "Password", "RABBITMQ_PASSWORD");
    }

    /// <summary>
    /// Private helper to validate individual configuration values.
    /// </summary>
    private static void ValidateConfigurationValue(
        IConfigurationSection section,
        string key,
        string environmentVariableName,
        int minLength = 1)
    {
        var value = section[key];
        if (string.IsNullOrWhiteSpace(value) || value.Length < minLength)
        {
            throw new InvalidOperationException(
                $"CRITICAL: Configuration '{section.Key}:{key}' is required (minimum {minLength} characters). " +
                $"Set via appsettings.json or {environmentVariableName} environment variable");
        }
    }
}
