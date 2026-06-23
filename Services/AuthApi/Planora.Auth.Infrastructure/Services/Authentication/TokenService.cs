using JsonWebTokenHandler = Microsoft.IdentityModel.JsonWebTokens.JsonWebTokenHandler;
using Planora.Auth.Infrastructure.Security;
using Planora.BuildingBlocks.Infrastructure.Configuration;

namespace Planora.Auth.Infrastructure.Services.Authentication;

public sealed class TokenService : ITokenService
{
    private readonly JwtSettings _jwtSettings;
    private readonly JsonWebTokenHandler _tokenHandler;
    private readonly SymmetricSecurityKey _signingKey;

    public TokenService(IOptions<JwtSettings> jwtSettings)
    {
        _jwtSettings = jwtSettings.Value;
        // JsonWebTokenHandler is the modern, allocation-friendly successor to
        // JwtSecurityTokenHandler. MapInboundClaims = false keeps short claim
        // names (e.g. "sub") instead of remapping them to the long WS-* URIs.
        _tokenHandler = new JsonWebTokenHandler { MapInboundClaims = false };
        _signingKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_jwtSettings.Secret));
    }

    public string GenerateAccessToken(User user)
    {
        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, user.Id.ToString()),
            new(JwtRegisteredClaimNames.Email, user.Email.Value),
            new(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString()),
            new("firstName", user.FirstName),
            new("lastName", user.LastName),
            new("profilePictureUrl", user.ProfilePictureUrl ?? string.Empty),
            new("email_verified", user.IsEmailVerified ? "true" : "false")
        };

        foreach (var role in user.Roles)
        {
            claims.Add(new Claim(ClaimTypes.Role, role));
        }

        var descriptor = new SecurityTokenDescriptor
        {
            Subject = new ClaimsIdentity(claims),
            Issuer = _jwtSettings.Issuer,
            Audience = _jwtSettings.Audience,
            IssuedAt = DateTime.UtcNow,
            Expires = DateTime.UtcNow.AddMinutes(_jwtSettings.AccessTokenExpirationMinutes),
            SigningCredentials = new SigningCredentials(_signingKey, SecurityAlgorithms.HmacSha256)
        };

        return _tokenHandler.CreateToken(descriptor);
    }

    public string GenerateRefreshToken()
    {
        var randomBytes = new byte[64];
        using var rng = RandomNumberGenerator.Create();
        rng.GetBytes(randomBytes);
        return Convert.ToBase64String(randomBytes);
    }

    public async Task<Guid?> ValidateAccessTokenAsync(string token)
    {
        var result = await _tokenHandler.ValidateTokenAsync(token, CreateValidationParameters(validateLifetime: true));
        if (!result.IsValid)
            return null;

        var userIdValue = result.ClaimsIdentity.FindFirst(JwtRegisteredClaimNames.Sub)?.Value
            ?? result.ClaimsIdentity.FindFirst(ClaimTypes.NameIdentifier)?.Value;

        return Guid.TryParse(userIdValue, out var userId) ? userId : null;
    }

    public async Task<ClaimsPrincipal?> GetPrincipalFromTokenAsync(string token)
    {
        // Lifetime is intentionally not validated here: this is used to read claims
        // out of an already-issued (possibly expired) token, e.g. during refresh.
        var result = await _tokenHandler.ValidateTokenAsync(token, CreateValidationParameters(validateLifetime: false));
        return result.IsValid ? new ClaimsPrincipal(result.ClaimsIdentity) : null;
    }

    public TimeSpan GetAccessTokenLifetime() =>
        TimeSpan.FromMinutes(_jwtSettings.AccessTokenExpirationMinutes);

    public TimeSpan GetRefreshTokenLifetime() =>
        TimeSpan.FromDays(_jwtSettings.RefreshTokenExpirationDays);

    private TokenValidationParameters CreateValidationParameters(bool validateLifetime) => new()
    {
        ValidateIssuer = true,
        ValidateAudience = true,
        ValidateLifetime = validateLifetime,
        ValidateIssuerSigningKey = true,
        ValidIssuer = _jwtSettings.Issuer,
        ValidAudience = _jwtSettings.Audience,
        IssuerSigningKey = _signingKey,
        ClockSkew = TimeSpan.FromSeconds(SecurityConstants.SecurityPolicies.TokenClockSkewSeconds)
    };
}
