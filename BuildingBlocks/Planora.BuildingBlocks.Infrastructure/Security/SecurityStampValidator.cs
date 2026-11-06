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
    /// Returns <c>true</c> when the token predates the stored security stamp or the check cannot
    /// be trusted. Fails <b>closed</b> for an invalid principal, unavailable Redis or corrupt stamp.
    /// A successful lookup with no stamp permits the token: stamps exist only after security events
    /// and expire after the access-token revocation window. When a stamp exists, a missing, malformed
    /// or out-of-range <c>iat</c> also rejects the token because it cannot be shown to postdate the event.
    /// (<c>iat</c> is reliably present on real tokens; see SecurityStampJwtClaimTests.)
    /// </summary>
    public static async Task<bool> IsTokenRevokedAsync(
        IConnectionMultiplexer? redis,
        ClaimsPrincipal? principal)
    {
        if (redis is null || principal?.Identity?.IsAuthenticated != true)
            return true;

        try
        {
            var sub = principal.FindFirst(ClaimTypes.NameIdentifier)?.Value
                      ?? principal.FindFirst("sub")?.Value;
            if (sub is null || !Guid.TryParse(sub, out var userId) || userId == Guid.Empty)
                return true;

            var raw = await redis.GetDatabase().StringGetAsync(StampKeyPrefix + userId);
            if (raw.IsNull)
                return false;

            if (!DateTime.TryParse(raw.ToString(), CultureInfo.InvariantCulture,
                    DateTimeStyles.RoundtripKind, out var stamp))
                return true;

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
            // An unavailable lookup or invalid timestamp cannot establish that the token is safe.
            return true;
        }
    }
}
