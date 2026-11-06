using System.Security.Claims;
using System.Text;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;
using Moq;
using Planora.Auth.Domain.Entities;
using Planora.Auth.Domain.ValueObjects;
using Planora.Auth.Infrastructure.Security;
using Planora.Auth.Infrastructure.Services.Authentication;
using Planora.BuildingBlocks.Infrastructure.Security;
using StackExchange.Redis;

namespace Planora.UnitTests.BuildingBlocks.Security;

public class SecurityStampValidatorTests
{
    [Fact]
    public async Task IsTokenRevokedAsync_ReturnsTrue_WhenRedisIsNull()
    {
        var principal = BuildPrincipal(Guid.NewGuid(), DateTimeOffset.UtcNow);

        Assert.True(await SecurityStampValidator.IsTokenRevokedAsync(null, principal));
    }

    [Fact]
    public async Task IsTokenRevokedAsync_ReturnsTrue_WhenPrincipalIsNull()
    {
        var redis = BuildRedis(RedisValue.Null);

        Assert.True(await SecurityStampValidator.IsTokenRevokedAsync(redis, null));
    }

    [Fact]
    public async Task IsTokenRevokedAsync_ReturnsTrue_WhenSubClaimMissing()
    {
        var principal = new ClaimsPrincipal(new ClaimsIdentity(new[]
        {
            new Claim("iat", DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString())
        }, "test"));

        Assert.True(await SecurityStampValidator.IsTokenRevokedAsync(BuildRedis(RedisValue.Null), principal));
    }

    [Fact]
    public async Task IsTokenRevokedAsync_ReturnsFalse_WhenIatClaimMissing()
    {
        var principal = new ClaimsPrincipal(new ClaimsIdentity(new[]
        {
            new Claim(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString())
        }, "test"));

        Assert.False(await SecurityStampValidator.IsTokenRevokedAsync(BuildRedis(RedisValue.Null), principal));
    }

    [Fact]
    public async Task IsTokenRevokedAsync_ReturnsFalse_WhenNoStampStored()
    {
        var principal = BuildPrincipal(Guid.NewGuid(), DateTimeOffset.UtcNow);

        Assert.False(await SecurityStampValidator.IsTokenRevokedAsync(BuildRedis(RedisValue.Null), principal));
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task IsTokenRevokedAsync_AcceptsRealValidatedJwt_WhenNoStampStored(bool mapInboundClaims)
    {
        const string secret = "this-is-a-very-long-test-secret-key-0123456789";
        var settings = new JwtSettings
        {
            Secret = secret,
            Issuer = "planora-test-issuer",
            Audience = "planora-test-audience",
            AccessTokenExpirationMinutes = 15
        };
        var token = new TokenService(Options.Create(settings))
            .GenerateAccessToken(User.Create(Email.Create("stamp@example.com"), "hash", "Stamp", "Test"));
        var handler = new JsonWebTokenHandler { MapInboundClaims = mapInboundClaims };
        var result = await handler.ValidateTokenAsync(token, new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidIssuer = settings.Issuer,
            ValidateAudience = true,
            ValidAudience = settings.Audience,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(secret))
        });

        Assert.True(result.IsValid);
        Assert.False(await SecurityStampValidator.IsTokenRevokedAsync(
            BuildRedis(RedisValue.Null), new ClaimsPrincipal(result.ClaimsIdentity)));
    }

    [Fact]
    public async Task IsTokenRevokedAsync_ReturnsTrue_WhenTokenIssuedBeforeStamp()
    {
        // Token minted an hour ago; the password was changed (stamp) one minute ago.
        var principal = BuildPrincipal(Guid.NewGuid(), DateTimeOffset.UtcNow.AddHours(-1));
        var redis = BuildRedis(DateTime.UtcNow.AddMinutes(-1).ToString("O"));

        Assert.True(await SecurityStampValidator.IsTokenRevokedAsync(redis, principal));
    }

    [Fact]
    public async Task IsTokenRevokedAsync_ReturnsFalse_WhenTokenIssuedAfterStamp()
    {
        // Token minted after the last password change — still valid.
        var principal = BuildPrincipal(Guid.NewGuid(), DateTimeOffset.UtcNow.AddMinutes(-1));
        var redis = BuildRedis(DateTime.UtcNow.AddHours(-1).ToString("O"));

        Assert.False(await SecurityStampValidator.IsTokenRevokedAsync(redis, principal));
    }

    [Fact]
    public async Task IsTokenRevokedAsync_ReturnsTrue_WhenStampExistsButIatMissing()
    {
        // A revocation event is recorded for the user, but the token carries no iat — we cannot
        // prove it was issued after the password change, so fail closed and force re-auth.
        var principal = new ClaimsPrincipal(new ClaimsIdentity(new[]
        {
            new Claim(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString())
        }, "test"));
        var redis = BuildRedis(DateTime.UtcNow.ToString("O"));

        Assert.True(await SecurityStampValidator.IsTokenRevokedAsync(redis, principal));
    }

    [Fact]
    public async Task IsTokenRevokedAsync_FailsClosed_WhenRedisThrows()
    {
        var principal = BuildPrincipal(Guid.NewGuid(), DateTimeOffset.UtcNow.AddHours(-1));
        var db = new Mock<IDatabase>();
        db.Setup(d => d.StringGetAsync(It.IsAny<RedisKey>(), It.IsAny<CommandFlags>()))
            .ThrowsAsync(new Exception("redis unavailable"));
        var redis = new Mock<IConnectionMultiplexer>();
        redis.Setup(r => r.GetDatabase(It.IsAny<int>(), It.IsAny<object>())).Returns(db.Object);

        Assert.True(await SecurityStampValidator.IsTokenRevokedAsync(redis.Object, principal));
    }

    [Fact]
    public async Task IsTokenRevokedAsync_ReturnsTrue_WhenPrincipalIsUnauthenticated()
    {
        var principal = new ClaimsPrincipal(new ClaimsIdentity(new[]
        {
            new Claim("sub", Guid.NewGuid().ToString()),
            new Claim("iat", "1793966400")
        }));

        Assert.True(await SecurityStampValidator.IsTokenRevokedAsync(BuildRedis(RedisValue.Null), principal));
    }

    [Theory]
    [InlineData("")]
    [InlineData("not-a-user-id")]
    [InlineData("00000000-0000-0000-0000-000000000000")]
    public async Task IsTokenRevokedAsync_ReturnsTrue_WhenSubClaimInvalid(string sub)
    {
        var principal = new ClaimsPrincipal(new ClaimsIdentity(new[]
        {
            new Claim("sub", sub),
            new Claim("iat", "1793966400")
        }, "test"));

        Assert.True(await SecurityStampValidator.IsTokenRevokedAsync(BuildRedis(RedisValue.Null), principal));
    }

    [Fact]
    public async Task IsTokenRevokedAsync_LooksUpCanonicalUserKey_ForUnmappedSub()
    {
        var userId = Guid.NewGuid();
        var principal = new ClaimsPrincipal(new ClaimsIdentity(new[]
        {
            new Claim("sub", userId.ToString("N")),
            new Claim("iat", "1793966400")
        }, "test"));
        var db = new Mock<IDatabase>(MockBehavior.Strict);
        db.Setup(d => d.StringGetAsync(SecurityStampValidator.StampKeyPrefix + userId, CommandFlags.None))
            .ReturnsAsync(RedisValue.Null);
        var redis = new Mock<IConnectionMultiplexer>();
        redis.Setup(r => r.GetDatabase(It.IsAny<int>(), It.IsAny<object>())).Returns(db.Object);

        Assert.False(await SecurityStampValidator.IsTokenRevokedAsync(redis.Object, principal));
        db.VerifyAll();
    }

    [Theory]
    [InlineData("")]
    [InlineData(" ")]
    [InlineData("corrupted-stamp")]
    [InlineData("2026-15-99T00:00:00Z")]
    public async Task IsTokenRevokedAsync_ReturnsTrue_WhenStoredStampIsCorrupt(string stamp)
    {
        var principal = BuildPrincipal(Guid.NewGuid(), DateTimeOffset.UtcNow);

        Assert.True(await SecurityStampValidator.IsTokenRevokedAsync(BuildRedis(stamp), principal));
    }

    [Theory]
    [InlineData("")]
    [InlineData("not-unix-seconds")]
    [InlineData("1793966400.5")]
    [InlineData("9223372036854775808")]
    [InlineData("9223372036854775807")]
    [InlineData("-9223372036854775808")]
    public async Task IsTokenRevokedAsync_ReturnsTrue_WhenStampExistsButIatInvalid(string iat)
    {
        var principal = new ClaimsPrincipal(new ClaimsIdentity(new[]
        {
            new Claim("sub", Guid.NewGuid().ToString()),
            new Claim("iat", iat)
        }, "test"));

        Assert.True(await SecurityStampValidator.IsTokenRevokedAsync(
            BuildRedis("2026-11-06T12:00:00.0000000Z"), principal));
    }

    [Theory]
    [InlineData("2026-11-06T11:59:59.9999999Z", false)]
    [InlineData("2026-11-06T12:00:00.0000000Z", false)]
    [InlineData("2026-11-06T12:00:00.0000001Z", true)]
    public async Task IsTokenRevokedAsync_PreservesStrictBeforeBoundaryAndStampPrecision(
        string stamp, bool expectedRevoked)
    {
        var principal = BuildPrincipal(Guid.NewGuid(), new DateTimeOffset(2026, 11, 6, 12, 0, 0, TimeSpan.Zero));

        Assert.Equal(expectedRevoked, await SecurityStampValidator.IsTokenRevokedAsync(BuildRedis(stamp), principal));
    }

    [Fact]
    public async Task IsTokenRevokedAsync_FailsClosed_WhenRedisDatabaseUnavailable()
    {
        var redis = new Mock<IConnectionMultiplexer>();
        redis.Setup(r => r.GetDatabase(It.IsAny<int>(), It.IsAny<object>()))
            .Throws(new InvalidOperationException("redis unavailable"));

        Assert.True(await SecurityStampValidator.IsTokenRevokedAsync(
            redis.Object, BuildPrincipal(Guid.NewGuid(), DateTimeOffset.UtcNow)));
    }

    private static ClaimsPrincipal BuildPrincipal(Guid userId, DateTimeOffset issuedAt) =>
        new(new ClaimsIdentity(new[]
        {
            new Claim(ClaimTypes.NameIdentifier, userId.ToString()),
            new Claim("iat", issuedAt.ToUnixTimeSeconds().ToString())
        }, "test"));

    private static IConnectionMultiplexer BuildRedis(RedisValue stampValue)
    {
        var db = new Mock<IDatabase>();
        db.Setup(d => d.StringGetAsync(It.IsAny<RedisKey>(), It.IsAny<CommandFlags>()))
            .ReturnsAsync(stampValue);
        var redis = new Mock<IConnectionMultiplexer>();
        redis.Setup(r => r.GetDatabase(It.IsAny<int>(), It.IsAny<object>())).Returns(db.Object);
        return redis.Object;
    }
}
