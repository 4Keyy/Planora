using System.Net;
using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Planora.BuildingBlocks.Infrastructure.Extensions;

namespace Planora.UnitTests.Services.Infrastructure;

/// <summary>
/// Pins down the rate-limit partition-key precedence: authenticated user id wins over
/// remote IP. Without this guarantee, every user sharing a NAT (corporate proxy,
/// mobile carrier CGN, household router) collapses into one bucket and starves each
/// other under the documented per-IP limits.
/// </summary>
public sealed class RateLimitPartitionKeyTests
{
    [Fact]
    [Trait("TestType", "Security")]
    [Trait("TestType", "Regression")]
    public void PartitionKey_UsesUserId_WhenSubClaimPresent()
    {
        var context = NewContext(remoteIp: IPAddress.Parse("10.0.0.1"));
        var identity = new ClaimsIdentity(new[]
        {
            new Claim("sub", "00000000-0000-0000-0000-000000000001"),
        }, authenticationType: "Bearer");
        context.User = new ClaimsPrincipal(identity);

        var key = ServiceCollectionExtensions.PartitionKey(context);

        Assert.Equal("u:00000000-0000-0000-0000-000000000001", key);
    }

    [Fact]
    [Trait("TestType", "Security")]
    [Trait("TestType", "Regression")]
    public void PartitionKey_UsesUserId_WhenNameIdentifierClaimPresent()
    {
        var context = NewContext(remoteIp: IPAddress.Parse("10.0.0.1"));
        var identity = new ClaimsIdentity(new[]
        {
            new Claim(ClaimTypes.NameIdentifier, "alice@example.test"),
        }, authenticationType: "Bearer");
        context.User = new ClaimsPrincipal(identity);

        var key = ServiceCollectionExtensions.PartitionKey(context);

        Assert.Equal("u:alice@example.test", key);
    }

    [Fact]
    [Trait("TestType", "Security")]
    [Trait("TestType", "Regression")]
    public void PartitionKey_FallsBackToIp_ForAnonymousRequests()
    {
        var context = NewContext(remoteIp: IPAddress.Parse("203.0.113.42"));

        var key = ServiceCollectionExtensions.PartitionKey(context);

        Assert.Equal("ip:203.0.113.42", key);
    }

    [Fact]
    [Trait("TestType", "Security")]
    public void PartitionKey_ReturnsAnonLiteral_WhenNoRemoteIp()
    {
        var context = NewContext(remoteIp: null);

        var key = ServiceCollectionExtensions.PartitionKey(context);

        Assert.Equal("anon", key);
    }

    [Fact]
    [Trait("TestType", "Security")]
    public void PartitionKey_NamespacesUserVsIp_SoCollisionIsImpossible()
    {
        var anonymousFromIp = NewContext(remoteIp: IPAddress.Parse("1.2.3.4"));
        var anonymousKey = ServiceCollectionExtensions.PartitionKey(anonymousFromIp);

        var authenticatedAs = NewContext(remoteIp: IPAddress.Parse("9.9.9.9"));
        var identity = new ClaimsIdentity(new[] { new Claim("sub", "1.2.3.4") }, "Bearer");
        authenticatedAs.User = new ClaimsPrincipal(identity);
        var authenticatedKey = ServiceCollectionExtensions.PartitionKey(authenticatedAs);

        // Even though the user's sub claim matches the other request's IP, the
        // namespace prefixes (u: vs ip:) keep the keys disjoint in Redis.
        Assert.NotEqual(anonymousKey, authenticatedKey);
        Assert.StartsWith("ip:", anonymousKey);
        Assert.StartsWith("u:", authenticatedKey);
    }

    [Fact]
    [Trait("TestType", "Security")]
    public void PartitionKey_PrefersUserId_EvenWhenIpIsPresent()
    {
        var context = NewContext(remoteIp: IPAddress.Parse("198.51.100.7"));
        var identity = new ClaimsIdentity(new[] { new Claim("sub", "user-42") }, "Bearer");
        context.User = new ClaimsPrincipal(identity);

        var key = ServiceCollectionExtensions.PartitionKey(context);

        Assert.Equal("u:user-42", key);
        Assert.DoesNotContain("198.51.100.7", key);
    }

    [Fact]
    [Trait("TestType", "Security")]
    public void PartitionKey_IgnoresBlankSubClaim_FallsBackToIp()
    {
        var context = NewContext(remoteIp: IPAddress.Parse("198.51.100.7"));
        var identity = new ClaimsIdentity(new[] { new Claim("sub", "   ") }, "Bearer");
        context.User = new ClaimsPrincipal(identity);

        var key = ServiceCollectionExtensions.PartitionKey(context);

        Assert.Equal("ip:198.51.100.7", key);
    }

    [Fact]
    [Trait("TestType", "Security")]
    public void PartitionKey_Throws_WhenContextIsNull()
    {
        Assert.Throws<ArgumentNullException>(() => ServiceCollectionExtensions.PartitionKey(null!));
    }

    private static DefaultHttpContext NewContext(IPAddress? remoteIp)
    {
        var ctx = new DefaultHttpContext();
        ctx.Connection.RemoteIpAddress = remoteIp;
        return ctx;
    }
}
