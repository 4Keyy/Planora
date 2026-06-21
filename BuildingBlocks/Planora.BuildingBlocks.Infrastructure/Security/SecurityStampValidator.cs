using System.Globalization;
using System.Security.Claims;
using StackExchange.Redis;

namespace Planora.BuildingBlocks.Infrastructure.Security;

/// <summary>
/// Cross-service check that rejects JWT access tokens issued before the user's
/// last password change. The Auth service writes a per-user "security stamp"
/// (a UTC timestamp) to Redis under <c>security:stamp:{userId}</c> on every
/// password change/reset. Any token whose <c>iat</c> precedes that stamp must
/// be treated as revoked even though its signature is still valid, so this is
/// invoked from the <c>OnTokenValidated</c> hook of every JWT-consuming service.
/// </summary>
public static class SecurityStampValidator
{
    public const string StampKeyPrefix = "security:stamp:";

    /// <summary>
    /// Returns <c>true</c> when the authenticated principal's token predates the stored security
    /// stamp and must be rejected. Fails <b>open</b> (returns <c>false</c>) when Redis is
    /// unavailable so a cache outage cannot lock out every user, and when no stamp exists for the
    /// user (no security event to enforce). When a stamp <b>does</b> exist, it fails <b>closed</b>:
    /// a token issued before the stamp is rejected, and so is a token whose <c>iat</c> cannot be
    /// read — because the revocation event is proven and the token cannot be shown to postdate it.
    /// (<c>iat</c> is reliably present on real tokens; see SecurityStampJwtClaimTests.)
    /// </summary>
    public static async Task<bool> IsTokenRevokedAsync(
        IConnectionMultiplexer? redis,
        ClaimsPrincipal? principal)
    {
        if (redis is null || principal is null)
            return false;

        try
        {
            var sub = principal.FindFirst(ClaimTypes.NameIdentifier)?.Value
                      ?? principal.FindFirst("sub")?.Value;
            if (sub is null || !Guid.TryParse(sub, out var userId))
                return false;

            var raw = await redis.GetDatabase().StringGetAsync(StampKeyPrefix + userId);
            if (raw.IsNullOrEmpty)
                return false;

            if (!DateTime.TryParse(raw.ToString(), CultureInfo.InvariantCulture,
                    DateTimeStyles.RoundtripKind, out var stamp))
                return false;

            // A revocation event exists for this user. We must prove the token was issued after it;
            // if iat is absent or unparseable we cannot, so fail closed and force re-authentication.
            var iat = principal.FindFirst("iat")?.Value;
            if (iat is null || !long.TryParse(iat, out var iatSeconds))
                return true;

            var issuedAt = DateTimeOffset.FromUnixTimeSeconds(iatSeconds).UtcDateTime;
            return issuedAt < stamp;
        }
        catch
        {
            // Redis outage or malformed data — do not lock every user out.
            return false;
        }
    }
}
