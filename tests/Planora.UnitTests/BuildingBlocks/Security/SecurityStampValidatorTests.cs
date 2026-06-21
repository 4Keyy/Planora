using System.Security.Claims;
using Moq;
using Planora.BuildingBlocks.Infrastructure.Security;
using StackExchange.Redis;

namespace Planora.UnitTests.BuildingBlocks.Security;

public class SecurityStampValidatorTests
{
    [Fact]
    public async Task IsTokenRevokedAsync_ReturnsFalse_WhenRedisIsNull()
    {
        var principal = BuildPrincipal(Guid.NewGuid(), DateTimeOffset.UtcNow);

        Assert.False(await SecurityStampValidator.IsTokenRevokedAsync(null, principal));
    }

    [Fact]
    public async Task IsTokenRevokedAsync_ReturnsFalse_WhenPrincipalIsNull()
    {
        var redis = BuildRedis(RedisValue.Null);

        Assert.False(await SecurityStampValidator.IsTokenRevokedAsync(redis, null));
    }

    [Fact]
    public async Task IsTokenRevokedAsync_ReturnsFalse_WhenSubClaimMissing()
    {
        var principal = new ClaimsPrincipal(new ClaimsIdentity(new[]
        {
            new Claim("iat", DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString())
        }));

        Assert.False(await SecurityStampValidator.IsTokenRevokedAsync(BuildRedis(RedisValue.Null), principal));
    }

    [Fact]
    public async Task IsTokenRevokedAsync_ReturnsFalse_WhenIatClaimMissing()
    {
        var principal = new ClaimsPrincipal(new ClaimsIdentity(new[]
        {
            new Claim(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString())
        }));

        Assert.False(await SecurityStampValidator.IsTokenRevokedAsync(BuildRedis(RedisValue.Null), principal));
    }

    [Fact]
    public async Task IsTokenRevokedAsync_ReturnsFalse_WhenNoStampStored()
    {
        var principal = BuildPrincipal(Guid.NewGuid(), DateTimeOffset.UtcNow);

        Assert.False(await SecurityStampValidator.IsTokenRevokedAsync(BuildRedis(RedisValue.Null), principal));
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
        }));
        var redis = BuildRedis(DateTime.UtcNow.ToString("O"));

        Assert.True(await SecurityStampValidator.IsTokenRevokedAsync(redis, principal));
    }

    [Fact]
    public async Task IsTokenRevokedAsync_FailsOpen_WhenRedisThrows()
    {
        var principal = BuildPrincipal(Guid.NewGuid(), DateTimeOffset.UtcNow.AddHours(-1));
        var db = new Mock<IDatabase>();
        db.Setup(d => d.StringGetAsync(It.IsAny<RedisKey>(), It.IsAny<CommandFlags>()))
            .ThrowsAsync(new Exception("redis unavailable"));
        var redis = new Mock<IConnectionMultiplexer>();
        redis.Setup(r => r.GetDatabase(It.IsAny<int>(), It.IsAny<object>())).Returns(db.Object);

        Assert.False(await SecurityStampValidator.IsTokenRevokedAsync(redis.Object, principal));
    }

    private static ClaimsPrincipal BuildPrincipal(Guid userId, DateTimeOffset issuedAt) =>
        new(new ClaimsIdentity(new[]
        {
            new Claim(ClaimTypes.NameIdentifier, userId.ToString()),
            new Claim("iat", issuedAt.ToUnixTimeSeconds().ToString())
        }));

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
