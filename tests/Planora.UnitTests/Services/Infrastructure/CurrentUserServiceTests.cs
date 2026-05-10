using System.Net;
using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using CategoryCurrentUserService = Planora.Category.Infrastructure.Services.CurrentUserService;
using AuthCurrentUserService = Planora.Auth.Infrastructure.Services.Common.CurrentUserService;

namespace Planora.UnitTests.Services.Infrastructure;

public sealed class CurrentUserServiceTests
{
    [Fact]
    [Trait("TestType", "Security")]
    [Trait("TestType", "Regression")]
    public void AuthCurrentUserService_ShouldReadClaimsConnectionAndHeaders()
    {
        var userId = Guid.NewGuid();
        var context = CreateHttpContext(new[]
        {
            new Claim(ClaimTypes.NameIdentifier, userId.ToString()),
            new Claim(ClaimTypes.Email, "auth@example.com"),
            new Claim(ClaimTypes.Role, "Admin"),
            new Claim("custom", "value")
        });
        var service = new AuthCurrentUserService(new HttpContextAccessor { HttpContext = context });

        Assert.Equal(userId, service.UserId);
        Assert.Equal("auth@example.com", service.Email);
        Assert.Equal("127.0.0.1", service.IpAddress);
        Assert.Equal("UnitTestAgent", service.UserAgent);
        Assert.True(service.IsAuthenticated);
        Assert.Equal(new[] { "Admin" }, service.Roles);
        Assert.Equal("value", service.Claims["custom"]);
    }

    [Fact]
    [Trait("TestType", "Security")]
    [Trait("TestType", "Regression")]
    public void AuthCurrentUserService_ShouldHandleMissingOrInvalidHttpContext()
    {
        var noContext = new AuthCurrentUserService(new HttpContextAccessor());
        Assert.Null(noContext.UserId);
        Assert.Null(noContext.Email);
        Assert.Null(noContext.IpAddress);
        Assert.Null(noContext.UserAgent);
        Assert.False(noContext.IsAuthenticated);
        Assert.Empty(noContext.Roles);
        Assert.Empty(noContext.Claims);

        var invalidContext = CreateHttpContext(new[] { new Claim(ClaimTypes.NameIdentifier, "not-a-guid") });
        var invalid = new AuthCurrentUserService(new HttpContextAccessor { HttpContext = invalidContext });
        Assert.Null(invalid.UserId);
    }

    [Fact]
    [Trait("TestType", "Security")]
    [Trait("TestType", "Regression")]
    public void CategoryCurrentUserService_ShouldReadStandardAndJwtStyleClaims()
    {
        var standardUserId = Guid.NewGuid();
        var standard = new CategoryCurrentUserService(new HttpContextAccessor
        {
            HttpContext = CreateHttpContext(new[]
            {
                new Claim(ClaimTypes.NameIdentifier, standardUserId.ToString()),
                new Claim(ClaimTypes.Email, "standard@example.com"),
                new Claim(ClaimTypes.Role, "Manager")
            })
        });

        Assert.Equal(standardUserId, standard.UserId);
        Assert.Equal("standard@example.com", standard.Email);
        Assert.Equal("127.0.0.1", standard.IpAddress);
        Assert.Equal("UnitTestAgent", standard.UserAgent);
        Assert.True(standard.IsAuthenticated);
        Assert.Equal(new[] { "Manager" }, standard.Roles);

        var jwtUserId = Guid.NewGuid();
        var jwtStyle = new CategoryCurrentUserService(new HttpContextAccessor
        {
            HttpContext = CreateHttpContext(new[]
            {
                new Claim("sub", jwtUserId.ToString()),
                new Claim("email", "jwt@example.com")
            })
        });

        Assert.Equal(jwtUserId, jwtStyle.UserId);
        Assert.Equal("jwt@example.com", jwtStyle.Email);
    }

    [Fact]
    [Trait("TestType", "Security")]
    [Trait("TestType", "Regression")]
    public void CategoryCurrentUserService_ShouldHandleMissingOrInvalidContext()
    {
        var noContext = new CategoryCurrentUserService(new HttpContextAccessor());
        Assert.Null(noContext.UserId);
        Assert.Null(noContext.Email);
        Assert.Null(noContext.IpAddress);
        Assert.Null(noContext.UserAgent);
        Assert.False(noContext.IsAuthenticated);
        Assert.Empty(noContext.Roles);

        var invalidContext = CreateHttpContext(new[] { new Claim("sub", "not-a-guid") });
        var invalid = new CategoryCurrentUserService(new HttpContextAccessor { HttpContext = invalidContext });
        Assert.Null(invalid.UserId);
    }

    private static DefaultHttpContext CreateHttpContext(IEnumerable<Claim> claims)
    {
        var context = new DefaultHttpContext
        {
            User = new ClaimsPrincipal(new ClaimsIdentity(claims, "TestAuth"))
        };
        context.Connection.RemoteIpAddress = IPAddress.Parse("127.0.0.1");
        context.Request.Headers.UserAgent = "UnitTestAgent";
        return context;
    }
}
