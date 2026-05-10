using Planora.Auth.Application.Common.Security;

namespace Planora.Auth.Infrastructure.Services.Authentication;

public sealed class PasswordResetTokenService : IPasswordResetTokenService
{
    private readonly TimeSpan _tokenLifetime;

    public PasswordResetTokenService(IConfiguration configuration)
    {
        var lifetimeMinutes = configuration.GetValue("PasswordReset:TokenLifetimeMinutes", 15);
        _tokenLifetime = TimeSpan.FromMinutes(Math.Clamp(lifetimeMinutes, 5, 60));
    }

    public TimeSpan TokenLifetime => _tokenLifetime;

    public string GenerateToken()
    {
        return OpaqueToken.Generate();
    }

    public string HashToken(string token)
    {
        if (string.IsNullOrWhiteSpace(token))
        {
            return string.Empty;
        }

        return OpaqueToken.Hash(token);
    }

    public bool IsTokenValid(string token, string? expectedHash, DateTime? expiresAt)
    {
        if (string.IsNullOrWhiteSpace(token)
            || string.IsNullOrWhiteSpace(expectedHash)
            || !expiresAt.HasValue
            || expiresAt.Value <= DateTime.UtcNow)
        {
            return false;
        }

        var actualHash = HashToken(token);
        var actualBytes = Encoding.UTF8.GetBytes(actualHash);
        var expectedBytes = Encoding.UTF8.GetBytes(expectedHash);

        return actualBytes.Length == expectedBytes.Length
               && CryptographicOperations.FixedTimeEquals(actualBytes, expectedBytes);
    }
}
