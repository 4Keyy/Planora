namespace Planora.Auth.Application.Common.Interfaces;

public interface ITokenService
{
    string GenerateAccessToken(User user);
    string GenerateRefreshToken();
    Task<Guid?> ValidateAccessTokenAsync(string token);
    Task<ClaimsPrincipal?> GetPrincipalFromTokenAsync(string token);
    TimeSpan GetAccessTokenLifetime();
    TimeSpan GetRefreshTokenLifetime();
}