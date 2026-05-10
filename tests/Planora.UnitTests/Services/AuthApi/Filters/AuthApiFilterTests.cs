using System.Security.Claims;
using Planora.Auth.Api.Filters;
using Planora.Auth.Application.Common.Interfaces;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Abstractions;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Logging;
using Moq;

namespace Planora.UnitTests.Services.AuthApi.Filters;

public sealed class AuthApiFilterTests
{
    [Theory]
    [Trait("TestType", "Security")]
    [Trait("TestType", "Regression")]
    [InlineData(false, null, true, null)]
    [InlineData(true, "true", true, null)]
    [InlineData(true, null, false, StatusCodes.Status403Forbidden)]
    [InlineData(true, "false", false, StatusCodes.Status403Forbidden)]
    public async Task RequireEmailVerifiedFilter_ShouldOnlyBlockAuthenticatedUsersWithoutVerifiedEmail(
        bool authenticated,
        string? emailVerified,
        bool expectedNextCalled,
        int? expectedStatusCode)
    {
        var filter = new RequireEmailVerifiedFilter();
        var context = CreateExecutingContext();
        context.HttpContext.User = CreatePrincipal(authenticated, emailVerified);
        var nextCalled = false;

        await filter.OnActionExecutionAsync(context, () =>
        {
            nextCalled = true;
            return Task.FromResult(CreateExecutedContext(context));
        });

        Assert.Equal(expectedNextCalled, nextCalled);
        if (expectedStatusCode.HasValue)
        {
            var result = Assert.IsType<ObjectResult>(context.Result);
            Assert.Equal(expectedStatusCode.Value, result.StatusCode);
            Assert.Contains("EMAIL_NOT_VERIFIED", result.Value!.ToString());
        }
        else
        {
            Assert.Null(context.Result);
        }
    }

    [Theory]
    [Trait("TestType", "Security")]
    [Trait("TestType", "Regression")]
    [InlineData(null, false, true)]
    [InlineData("Basic abc", false, true)]
    [InlineData("Bearer active-token", false, true)]
    [InlineData("Bearer revoked-token", true, false)]
    [InlineData("bearer revoked-token", true, false)]
    public async Task TokenBlacklistFilter_ShouldRejectOnlyBlacklistedBearerTokens(
        string? authorizationHeader,
        bool blacklisted,
        bool expectedNextCalled)
    {
        var blacklist = new Mock<ITokenBlacklistService>();
        blacklist
            .Setup(x => x.IsTokenBlacklistedAsync("active-token", It.IsAny<CancellationToken>()))
            .ReturnsAsync(false);
        blacklist
            .Setup(x => x.IsTokenBlacklistedAsync("revoked-token", It.IsAny<CancellationToken>()))
            .ReturnsAsync(blacklisted);
        var filter = new TokenBlacklistFilter(
            blacklist.Object,
            Mock.Of<ILogger<TokenBlacklistFilter>>());
        var context = CreateExecutingContext();
        if (authorizationHeader is not null)
        {
            context.HttpContext.Request.Headers.Authorization = authorizationHeader;
        }

        var nextCalled = false;
        await filter.OnActionExecutionAsync(context, () =>
        {
            nextCalled = true;
            return Task.FromResult(CreateExecutedContext(context));
        });

        Assert.Equal(expectedNextCalled, nextCalled);
        if (blacklisted)
        {
            var result = Assert.IsType<UnauthorizedObjectResult>(context.Result);
            Assert.Contains("TOKEN_REVOKED", result.Value!.ToString());
        }
        else
        {
            Assert.Null(context.Result);
        }
    }

    private static ClaimsPrincipal CreatePrincipal(bool authenticated, string? emailVerified)
    {
        var claims = new List<Claim>();
        if (emailVerified is not null)
        {
            claims.Add(new Claim("email_verified", emailVerified));
        }

        var identity = new ClaimsIdentity(claims, authenticated ? "TestAuth" : null);
        return new ClaimsPrincipal(identity);
    }

    private static ActionExecutingContext CreateExecutingContext()
    {
        var httpContext = new DefaultHttpContext();
        var actionContext = new ActionContext(
            httpContext,
            new RouteData(),
            new ActionDescriptor());

        return new ActionExecutingContext(
            actionContext,
            Array.Empty<IFilterMetadata>().ToList(),
            new Dictionary<string, object?>(),
            controller: new object());
    }

    private static ActionExecutedContext CreateExecutedContext(ActionExecutingContext context)
        => new(
            context,
            Array.Empty<IFilterMetadata>().ToList(),
            context.Controller);
}
