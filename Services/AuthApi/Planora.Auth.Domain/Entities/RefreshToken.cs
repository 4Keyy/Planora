using Planora.Auth.Domain.Exceptions;
using Planora.Auth.Domain.Security;

namespace Planora.Auth.Domain.Entities;

public sealed class RefreshToken : BaseEntity
{
    public Guid UserId { get; private set; }

    /// <summary>
    /// SHA-256 hash of the raw refresh token — never the raw value. Set via the constructor /
    /// <see cref="UpdateForReLogin"/> from a raw token; compare a presented raw token with
    /// <see cref="Matches"/>. The raw value exists only transiently in the issuing handler, which
    /// returns it to the client.
    /// </summary>
    public string Token { get; private set; }
    public DateTime ExpiresAt { get; private set; }
    public string CreatedByIp { get; private set; }
    public DateTime? RevokedAt { get; private set; }
    public string? RevokedByIp { get; private set; }
    public string? RevokedReason { get; private set; }
    public string? ReplacedByToken { get; private set; }

    public bool RememberMe { get; private set; }

    // Device tracking — nullable so existing rows without fingerprint are valid
    public string? DeviceFingerprint { get; private set; }
    public string? DeviceName { get; private set; }
    public DateTime LastLoginAt { get; private set; }
    public int LoginCount { get; private set; }

    public bool IsExpired => DateTime.UtcNow >= ExpiresAt;
    public bool IsRevoked => RevokedAt.HasValue;
    public bool IsActive => !IsRevoked && !IsExpired;

    // Navigation property
    public User User { get; private set; } = null!;

    private RefreshToken()
    {
        Token = string.Empty;
        CreatedByIp = string.Empty;
        RememberMe = false;
    }

    /// <summary>Legacy constructor — no device fingerprint (backwards-compatible).</summary>
    public RefreshToken(Guid userId, string token, string createdByIp, DateTime expiresAt, bool rememberMe = false)
        : this(userId, token, createdByIp, expiresAt, rememberMe, null, null)
    {
    }

    /// <summary>Full constructor — includes device tracking fields.</summary>
    public RefreshToken(
        Guid userId,
        string token,
        string createdByIp,
        DateTime expiresAt,
        bool rememberMe,
        string? deviceFingerprint,
        string? deviceName)
    {
        if (userId == Guid.Empty) throw new AuthDomainException("User ID cannot be empty");
        if (string.IsNullOrWhiteSpace(token)) throw new AuthDomainException("Token cannot be empty");
        if (string.IsNullOrWhiteSpace(createdByIp)) throw new AuthDomainException("IP address cannot be empty");
        if (expiresAt <= DateTime.UtcNow) throw new AuthDomainException("Expiration date must be in the future");

        UserId = userId;
        Token = RefreshTokenHash.Of(token);
        CreatedByIp = createdByIp;
        ExpiresAt = expiresAt;
        RememberMe = rememberMe;
        DeviceFingerprint = deviceFingerprint;
        DeviceName = deviceName;
        LastLoginAt = DateTime.UtcNow;
        LoginCount = 1;
        // CreatedAt is set by BaseEntity
    }

    /// <summary>
    /// True when <paramref name="rawToken"/> is the raw value this record was issued for, compared
    /// against the stored hash. Used everywhere a presented token must be located in memory.
    /// </summary>
    public bool Matches(string rawToken) =>
        !string.IsNullOrWhiteSpace(rawToken) && Token == RefreshTokenHash.Of(rawToken);

    public void Revoke(string revokedByIp, string reason, string? replacedByToken = null)
    {
        // Allow revoking already revoked tokens - idempotent operation
        if (IsRevoked) return;

        RevokedAt = DateTime.UtcNow;
        RevokedByIp = revokedByIp;
        RevokedReason = reason;
        ReplacedByToken = replacedByToken;
    }

    /// <summary>
    /// Refreshes the token values in-place when the same device re-authenticates.
    /// This implements session deduplication — one active record per device per user.
    /// </summary>
    public void UpdateForReLogin(string newToken, DateTime newExpiresAt, bool rememberMe, string ipAddress)
    {
        if (string.IsNullOrWhiteSpace(newToken)) throw new AuthDomainException("Token cannot be empty");
        if (string.IsNullOrWhiteSpace(ipAddress)) throw new AuthDomainException("IP address cannot be empty");
        if (newExpiresAt <= DateTime.UtcNow) throw new AuthDomainException("Expiration date must be in the future");

        // A revoked record must never be silently revived: doing so would resurrect a session that
        // was killed (logout, user-initiated revoke, reuse detection, password change) and erase the
        // revocation audit trail. Session dedup only ever targets ACTIVE rows; if a revoked one
        // reaches here it is a programming error, so fail loudly and let the caller mint a new token.
        if (IsRevoked)
            throw new AuthDomainException("Cannot reuse a revoked refresh token; issue a new one instead");

        Token = RefreshTokenHash.Of(newToken);
        ExpiresAt = newExpiresAt;
        RememberMe = rememberMe;
        CreatedByIp = ipAddress;
        LastLoginAt = DateTime.UtcNow;
        LoginCount += 1;
    }
}
