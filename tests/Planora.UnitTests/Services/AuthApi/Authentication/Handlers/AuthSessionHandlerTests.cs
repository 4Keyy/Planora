using AutoMapper;
using Planora.Auth.Application.Common.DTOs;
using Planora.Auth.Application.Common.Interfaces;
using Planora.Auth.Application.Features.Authentication.Commands.Logout;
using Planora.Auth.Application.Features.Authentication.Handlers.Logout;
using Planora.Auth.Application.Features.Users.Commands.RevokeSession;
using Planora.Auth.Application.Features.Users.Handlers.GetLoginHistory;
using Planora.Auth.Application.Features.Users.Handlers.RevokeSession;
using Planora.Auth.Application.Features.Users.Queries.GetLoginHistory;
using Planora.Auth.Domain.Entities;
using Planora.Auth.Domain.Repositories;
using Microsoft.Extensions.Logging;
using Moq;
using RefreshTokenEntity = Planora.Auth.Domain.Entities.RefreshToken;

namespace Planora.UnitTests.Services.AuthApi.Authentication.Handlers;

public class AuthSessionHandlerTests
{
    [Fact]
    [Trait("TestType", "Functional")]
    [Trait("TestType", "Security")]
    [Trait("TestType", "Regression")]
    public async Task Logout_ShouldRevokeActiveRefreshTokenAndPersist()
    {
        var userId = Guid.NewGuid();
        var token = CreateRefreshToken(userId, "refresh-token");
        var fixture = new SessionFixture(userId);
        fixture.RefreshTokens
            .Setup(x => x.GetByTokenAsync("refresh-token", It.IsAny<CancellationToken>()))
            .ReturnsAsync(token);

        var result = await fixture.CreateLogoutHandler().Handle(
            new LogoutCommand { RefreshToken = "refresh-token" },
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.True(token.IsRevoked);
        Assert.Equal("127.0.0.1", token.RevokedByIp);
        Assert.Equal("Logged out", token.RevokedReason);
        fixture.RefreshTokens.Verify(x => x.Update(token), Times.Once);
        fixture.UnitOfWork.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    [Trait("TestType", "Functional")]
    [Trait("TestType", "Regression")]
    public async Task Logout_ShouldBeIdempotentForMissingOrInvalidToken()
    {
        var fixture = new SessionFixture(Guid.NewGuid());

        var withoutToken = await fixture.CreateLogoutHandler().Handle(new LogoutCommand(), CancellationToken.None);
        Assert.True(withoutToken.IsSuccess);

        fixture.RefreshTokens
            .Setup(x => x.GetByTokenAsync("missing", It.IsAny<CancellationToken>()))
            .ReturnsAsync((RefreshTokenEntity?)null);

        var invalidToken = await fixture.CreateLogoutHandler().Handle(
            new LogoutCommand { RefreshToken = "missing" },
            CancellationToken.None);

        Assert.True(invalidToken.IsSuccess);
        fixture.UnitOfWork.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    [Trait("TestType", "Resilience")]
    [Trait("TestType", "Regression")]
    public async Task Logout_ShouldReturnFailureWhenRepositoryThrows()
    {
        var fixture = new SessionFixture(Guid.NewGuid());
        fixture.RefreshTokens
            .Setup(x => x.GetByTokenAsync("boom", It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("store unavailable"));

        var result = await fixture.CreateLogoutHandler().Handle(
            new LogoutCommand { RefreshToken = "boom" },
            CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("LOGOUT_ERROR", result.Error!.Code);
    }

    [Fact]
    [Trait("TestType", "Security")]
    [Trait("TestType", "Functional")]
    public async Task RevokeSession_ShouldRejectUnauthenticatedMissingForeignAndInactiveTokens()
    {
        var tokenId = Guid.NewGuid();
        var unauthenticated = new SessionFixture(null);
        var unauthenticatedResult = await unauthenticated.CreateRevokeSessionHandler().Handle(
            new RevokeSessionCommand { TokenId = tokenId },
            CancellationToken.None);
        Assert.Equal("NOT_AUTHENTICATED", unauthenticatedResult.Error!.Code);

        var userId = Guid.NewGuid();
        var fixture = new SessionFixture(userId);
        fixture.RefreshTokens
            .Setup(x => x.GetByIdAsync(tokenId, It.IsAny<CancellationToken>()))
            .ReturnsAsync((RefreshTokenEntity?)null);
        var missing = await fixture.CreateRevokeSessionHandler().Handle(
            new RevokeSessionCommand { TokenId = tokenId },
            CancellationToken.None);
        Assert.Equal("TOKEN_NOT_FOUND", missing.Error!.Code);

        var foreign = CreateRefreshToken(Guid.NewGuid(), "foreign-token");
        fixture.RefreshTokens
            .Setup(x => x.GetByIdAsync(foreign.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(foreign);
        var denied = await fixture.CreateRevokeSessionHandler().Handle(
            new RevokeSessionCommand { TokenId = foreign.Id },
            CancellationToken.None);
        Assert.Equal("ACCESS_DENIED", denied.Error!.Code);

        var inactive = CreateRefreshToken(userId, "inactive-token");
        inactive.Revoke("127.0.0.1", "already revoked");
        fixture.RefreshTokens
            .Setup(x => x.GetByIdAsync(inactive.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(inactive);
        var inactiveResult = await fixture.CreateRevokeSessionHandler().Handle(
            new RevokeSessionCommand { TokenId = inactive.Id },
            CancellationToken.None);
        Assert.Equal("SESSION_INACTIVE", inactiveResult.Error!.Code);
    }

    [Fact]
    [Trait("TestType", "Security")]
    [Trait("TestType", "Regression")]
    public async Task RevokeSession_ShouldRevokeOwnActiveToken()
    {
        var userId = Guid.NewGuid();
        var token = CreateRefreshToken(userId, "own-token");
        var fixture = new SessionFixture(userId);
        fixture.RefreshTokens
            .Setup(x => x.GetByIdAsync(token.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(token);

        var result = await fixture.CreateRevokeSessionHandler().Handle(
            new RevokeSessionCommand { TokenId = token.Id },
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.True(token.IsRevoked);
        Assert.Equal("Revoked by user", token.RevokedReason);
        fixture.RefreshTokens.Verify(x => x.Update(token), Times.Once);
        fixture.UnitOfWork.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    [Trait("TestType", "Functional")]
    [Trait("TestType", "Regression")]
    public async Task GetLoginHistory_ShouldPageCurrentUsersHistory()
    {
        var userId = Guid.NewGuid();
        var history = new[]
        {
            new LoginHistory(userId, "10.0.0.1", "Chrome", true),
            new LoginHistory(userId, "10.0.0.2", "Firefox", false, "bad password"),
            new LoginHistory(userId, "10.0.0.3", "Edge", true)
        };
        var fixture = new SessionFixture(userId);
        fixture.LoginHistory
            .Setup(x => x.GetByUserIdAsync(userId, 1000, It.IsAny<CancellationToken>()))
            .ReturnsAsync(history);

        var result = await fixture.CreateGetLoginHistoryHandler().Handle(
            new GetLoginHistoryQuery { PageNumber = 2, PageSize = 1 },
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(3, result.Value!.TotalCount);
        Assert.Single(result.Value.Items);
        Assert.Equal("10.0.0.2", result.Value.Items.Single().IpAddress);
    }

    [Fact]
    [Trait("TestType", "Security")]
    [Trait("TestType", "Resilience")]
    public async Task GetLoginHistory_ShouldReturnFailuresForUnauthenticatedOrRepositoryException()
    {
        var unauthenticated = new SessionFixture(null);
        var notAuthenticated = await unauthenticated.CreateGetLoginHistoryHandler().Handle(
            new GetLoginHistoryQuery(),
            CancellationToken.None);
        Assert.Equal("NOT_AUTHENTICATED", notAuthenticated.Error!.Code);

        var userId = Guid.NewGuid();
        var fixture = new SessionFixture(userId);
        fixture.LoginHistory
            .Setup(x => x.GetByUserIdAsync(userId, 1000, It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("history store unavailable"));

        var failure = await fixture.CreateGetLoginHistoryHandler().Handle(
            new GetLoginHistoryQuery(),
            CancellationToken.None);

        Assert.True(failure.IsFailure);
        Assert.Equal("GET_HISTORY_ERROR", failure.Error!.Code);
    }

    private static RefreshTokenEntity CreateRefreshToken(Guid userId, string token)
    {
        return new RefreshTokenEntity(userId, token, "127.0.0.1", DateTime.UtcNow.AddDays(7));
    }

    private sealed class SessionFixture
    {
        public SessionFixture(Guid? userId)
        {
            UnitOfWork.SetupGet(x => x.RefreshTokens).Returns(RefreshTokens.Object);
            UnitOfWork.SetupGet(x => x.LoginHistory).Returns(LoginHistory.Object);
            UnitOfWork.Setup(x => x.SaveChangesAsync(It.IsAny<CancellationToken>())).ReturnsAsync(1);

            CurrentUser.SetupGet(x => x.UserId).Returns(userId);
            CurrentUser.SetupGet(x => x.IpAddress).Returns("127.0.0.1");

            Mapper
                .Setup(x => x.Map<List<LoginHistoryPagedDto>>(It.IsAny<List<LoginHistory>>()))
                .Returns((List<LoginHistory> source) => source.Select(item => new LoginHistoryPagedDto
                {
                    Id = item.Id,
                    IpAddress = item.IpAddress,
                    UserAgent = item.UserAgent,
                    IsSuccessful = item.IsSuccessful,
                    FailureReason = item.FailureReason,
                    LoginAt = item.LoginAt
                }).ToList());
        }

        public Mock<IAuthUnitOfWork> UnitOfWork { get; } = new();
        public Mock<IRefreshTokenRepository> RefreshTokens { get; } = new();
        public Mock<ILoginHistoryRepository> LoginHistory { get; } = new();
        public Mock<ICurrentUserService> CurrentUser { get; } = new();
        public Mock<IMapper> Mapper { get; } = new();

        public LogoutCommandHandler CreateLogoutHandler()
        {
            return new LogoutCommandHandler(
                UnitOfWork.Object,
                CurrentUser.Object,
                Mock.Of<ILogger<LogoutCommandHandler>>());
        }

        public RevokeSessionCommandHandler CreateRevokeSessionHandler()
        {
            return new RevokeSessionCommandHandler(
                UnitOfWork.Object,
                CurrentUser.Object,
                Mock.Of<ILogger<RevokeSessionCommandHandler>>());
        }

        public GetLoginHistoryQueryHandler CreateGetLoginHistoryHandler()
        {
            return new GetLoginHistoryQueryHandler(
                LoginHistory.Object,
                CurrentUser.Object,
                Mapper.Object,
                Mock.Of<ILogger<GetLoginHistoryQueryHandler>>());
        }
    }
}
