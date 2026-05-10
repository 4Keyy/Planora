namespace Planora.Auth.Application.Common.Interfaces;

public interface ITokenService
{
    string GenerateAccessToken(User user);
    string GenerateRefreshToken();
    Guid? ValidateAccessToken(string token);
    ClaimsPrincipal? GetPrincipalFromToken(string token);
    TimeSpan GetAccessTokenLifetime();
    TimeSpan GetRefreshTokenLifetime();
}