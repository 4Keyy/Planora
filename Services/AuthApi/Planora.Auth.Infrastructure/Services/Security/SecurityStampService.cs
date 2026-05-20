using Planora.Auth.Application.Common.Interfaces;

namespace Planora.Auth.Infrastructure.Services.Security;

/// <summary>
/// Redis-backed security stamp. Key TTL is deliberately longer than the max access-token
/// lifetime so that any token issued before a password change is rejected for its full
/// remaining lifetime, then the stamp expires automatically.
/// </summary>
public sealed class SecurityStampService : ISecurityStampService
{
    private readonly IConnectionMultiplexer _redis;
    private readonly ILogger<SecurityStampService> _logger;

    // Keep stamps for 2× the max access-token TTL (60 min × 2 = 120 min).
    private static readonly TimeSpan StampTtl = TimeSpan.FromMinutes(120);
    private const string KeyPrefix = "security:stamp:";

    public SecurityStampService(IConnectionMultiplexer redis, ILogger<SecurityStampService> logger)
    {
        _redis = redis;
        _logger = logger;
    }

    public async Task SetStampAsync(Guid userId, CancellationToken cancellationToken = default)
    {
        var db = _redis.GetDatabase();
        var value = DateTime.UtcNow.ToString("O"); // ISO 8601 round-trip
        await db.StringSetAsync(KeyPrefix + userId, value, StampTtl);
        _logger.LogInformation("Security stamp updated for user {UserId}", userId);
    }

    public async Task<DateTime?> GetStampAsync(Guid userId, CancellationToken cancellationToken = default)
    {
        var db = _redis.GetDatabase();
        var value = await db.StringGetAsync(KeyPrefix + userId);
        if (value.IsNullOrEmpty) return null;

        return DateTime.TryParse(value, null, System.Globalization.DateTimeStyles.RoundtripKind, out var dt)
            ? dt
            : null;
    }
}
