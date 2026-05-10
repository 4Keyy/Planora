using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Planora.Auth.Domain.Entities;
using Planora.Auth.Domain.ValueObjects;
using Planora.Auth.Infrastructure.Security;
using Planora.Auth.Infrastructure.Services.Authentication;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;

namespace Planora.UnitTests.Services.AuthApi.Infrastructure.Authentication;

public class TokenServiceTests
{
    [Fact]
    public void GenerateAccessToken_ShouldContainExpectedIdentityClaims_AndValidateBackToUserId()
    {
        var service = CreateService();
        var user = User.Create(Email.Create("user@example.com"), "hash", "Ada", "Lovelace");
        user.VerifyEmail();
        AddRole(user, "Admin");

        var token = service.GenerateAccessToken(user);

        var principal = service.GetPrincipalFromToken(token);
        Assert.NotNull(principal);
        Assert.Equal(user.Id.ToString(), principal!.FindFirstValue(JwtRegisteredClaimNames.Sub));
        Assert.Equal("user@example.com", principal.FindFirstValue(JwtRegisteredClaimNames.Email));
        Assert.Equal("Ada", principal.FindFirstValue("firstName"));
        Assert.Equal("Lovelace", principal.FindFirstValue("lastName"));
        Assert.Equal("True", principal.FindFirstValue("emailVerified"));
        Assert.Equal("true", principal.FindFirstValue("email_verified"));
        Assert.Contains(principal.Claims, claim => claim.Type == ClaimTypes.Role && claim.Value == "Admin");
        Assert.Equal(user.Id, service.ValidateAccessToken(token));
    }

    [Fact]
    public void ValidateAccessToken_ShouldRejectInvalidExpiredAndWrongIssuerTokens()
    {
        var validSettings = CreateSettings();
        var service = new TokenService(Options.Create(validSettings));

        Assert.Null(service.ValidateAccessToken("not-a-jwt"));
        Assert.Null(service.GetPrincipalFromToken("not-a-jwt"));

        var expiredSettings = CreateSettings();
        expiredSettings.AccessTokenExpirationMinutes = -1;
        var expiredToken = new TokenService(Options.Create(expiredSettings))
            .GenerateAccessToken(User.Create(Email.Create("expired@example.com"), "hash", "Expired", "User"));
        Assert.Null(service.ValidateAccessToken(expiredToken));

        var wrongIssuerSettings = CreateSettings();
        wrongIssuerSettings.Issuer = "https://issuer.other.example";
        var wrongIssuerToken = new TokenService(Options.Create(wrongIssuerSettings))
            .GenerateAccessToken(User.Create(Email.Create("issuer@example.com"), "hash", "Issuer", "User"));
        Assert.Null(service.ValidateAccessToken(wrongIssuerToken));

        var tokenWithoutUserId = CreateSignedTokenWithoutUserId(validSettings);
        Assert.Null(service.ValidateAccessToken(tokenWithoutUserId));
    }

    [Fact]
    public void GenerateRefreshToken_ShouldBeHighEntropyBase64_AndDifferentEachTime()
    {
        var service = CreateService();

        var first = service.GenerateRefreshToken();
        var second = service.GenerateRefreshToken();

        Assert.NotEqual(first, second);
        Assert.Equal(64, Convert.FromBase64String(first).Length);
        Assert.Equal(64, Convert.FromBase64String(second).Length);
    }

    [Fact]
    public void TokenLifetimes_ShouldReflectJwtSettings()
    {
        var settings = CreateSettings();
        settings.AccessTokenExpirationMinutes = 42;
        settings.RefreshTokenExpirationDays = 21;
        var service = new TokenService(Options.Create(settings));

        Assert.Equal(TimeSpan.FromMinutes(42), service.GetAccessTokenLifetime());
        Assert.Equal(TimeSpan.FromDays(21), service.GetRefreshTokenLifetime());
    }

    private static TokenService CreateService()
        => new(Options.Create(CreateSettings()));

    private static JwtSettings CreateSettings()
        => new()
        {
            Secret = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
            Issuer = "https://auth.example.com",
            Audience = "planora-tests",
            AccessTokenExpirationMinutes = 15,
            RefreshTokenExpirationDays = 7
        };

    private static string CreateSignedTokenWithoutUserId(JwtSettings settings)
    {
        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(settings.Secret));
        var descriptor = new SecurityTokenDescriptor
        {
            Subject = new ClaimsIdentity(new[]
            {
                new Claim(JwtRegisteredClaimNames.Email, "missing-id@example.com")
            }),
            Expires = DateTime.UtcNow.AddMinutes(5),
            Issuer = settings.Issuer,
            Audience = settings.Audience,
            SigningCredentials = new SigningCredentials(key, SecurityAlgorithms.HmacSha256)
        };
        var handler = new JwtSecurityTokenHandler();
        return handler.WriteToken(handler.CreateToken(descriptor));
    }

    private static void AddRole(User user, string roleName)
    {
        var role = Role.Create(roleName);
        var userRole = UserRole.Create(user.Id, role.Id);
        typeof(UserRole)
            .GetProperty(nameof(UserRole.Role))!
            .SetValue(userRole, role);

        var field = typeof(User).GetField("_userRoles", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic);
        var roles = Assert.IsType<List<UserRole>>(field!.GetValue(user));
        roles.Add(userRole);
    }
}
