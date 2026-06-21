using System.Security.Claims;
using System.Text;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;
using Planora.Auth.Domain.Entities;
using Planora.Auth.Domain.ValueObjects;
using Planora.Auth.Infrastructure.Security;
using Planora.Auth.Infrastructure.Services.Authentication;

namespace Planora.UnitTests.BuildingBlocks.Security;

/// <summary>
/// Empirical guard for the cross-service token-revocation mechanism: a real access token minted by
/// the Auth <see cref="TokenService"/> must, after consumer-side validation, expose a parseable
/// <c>iat</c> claim — otherwise <see cref="Planora.BuildingBlocks.Infrastructure.Security.SecurityStampValidator"/>
/// silently fails open and a password change never revokes already-issued access tokens.
/// </summary>
public class SecurityStampJwtClaimTests
{
    private const string Secret = "this-is-a-very-long-test-secret-key-0123456789";
    private const string Issuer = "planora-test-issuer";
    private const string Audience = "planora-test-audience";

    [Theory]
    [InlineData(true)]   // the JwtBearer consumer default
    [InlineData(false)]  // explicit, claim-name-preserving mode
    public async Task ValidatedConsumerToken_ExposesParseableIatClaim(bool mapInboundClaims)
    {
        var settings = new JwtSettings
        {
            Secret = Secret,
            Issuer = Issuer,
            Audience = Audience,
            AccessTokenExpirationMinutes = 15
        };
        var token = new TokenService(Options.Create(settings))
            .GenerateAccessToken(User.Create(Email.Create("iat@example.com"), "hash", "Iat", "Test"));

        var handler = new JsonWebTokenHandler { MapInboundClaims = mapInboundClaims };
        var result = await handler.ValidateTokenAsync(token, new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidIssuer = Issuer,
            ValidateAudience = true,
            ValidAudience = Audience,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(Secret))
        });

        Assert.True(result.IsValid);
        var principal = new ClaimsPrincipal(result.ClaimsIdentity);

        var iat = principal.FindFirst("iat");
        Assert.NotNull(iat);
        Assert.True(long.TryParse(iat!.Value, out _), $"iat value '{iat.Value}' is not unix seconds");
    }
}
