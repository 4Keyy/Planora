namespace Planora.Auth.Application.Common.Interfaces;

/// <summary>
/// Tracks the last security-relevant event (password change, password reset) per user.
/// Any access token issued before the stamp is considered revoked.
/// </summary>
public interface ISecurityStampService
{
    /// <summary>Records a new stamp for the given user using the current UTC time.</summary>
    Task SetStampAsync(Guid userId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Returns the UTC time of the last stamp, or null if none exists.
    /// A token whose <c>iat</c> claim predates this value must be rejected.
    /// </summary>
    Task<DateTime?> GetStampAsync(Guid userId, CancellationToken cancellationToken = default);
}
