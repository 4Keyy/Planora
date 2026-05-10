namespace Planora.Auth.Application.Common.Interfaces;

public interface IPasswordResetTokenService
{
    TimeSpan TokenLifetime { get; }

    string GenerateToken();

    string HashToken(string token);

    bool IsTokenValid(string token, string? expectedHash, DateTime? expiresAt);
}
