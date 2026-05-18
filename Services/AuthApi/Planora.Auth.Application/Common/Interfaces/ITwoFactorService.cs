namespace Planora.Auth.Application.Common.Interfaces
{
    public interface ITwoFactorService
    {
        string GenerateSecret();

        string GenerateQrCodeUrl(string email, string secret);

        /// <summary>
        /// Verifies a TOTP code for the given user.
        /// The userId is required for replay protection: each time step can only be
        /// accepted once per user, preventing an intercepted code from being replayed
        /// within its validity window.
        /// </summary>
        Task<bool> VerifyCodeAsync(string secret, string code, Guid userId, CancellationToken cancellationToken = default);
    }
}
