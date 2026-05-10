using AutoMapper;
using Planora.Auth.Application.Common.DTOs;
using Planora.Auth.Application.Common.Interfaces;
using Planora.Auth.Application.Features.Users.Handlers.GetCurrentUser;
using Planora.Auth.Application.Features.Users.Handlers.GetUser;
using Planora.Auth.Application.Features.Users.Handlers.GetUserSessions;
using Planora.Auth.Application.Features.Users.Handlers.GetUserStatistics;
using Planora.Auth.Application.Features.Users.Queries.GetCurrentUser;
using Planora.Auth.Application.Features.Users.Queries.GetUser;
using Planora.Auth.Application.Features.Users.Queries.GetUserSessions;
using Planora.Auth.Application.Features.Users.Queries.GetUserStatistics;
using Planora.Auth.Domain.Entities;
using Planora.Auth.Domain.Repositories;
using Planora.Auth.Domain.ValueObjects;
using Planora.BuildingBlocks.Domain;
using Microsoft.Extensions.Logging;
using Moq;
using AuthEmail = Planora.Auth.Domain.ValueObjects.Email;
using RefreshTokenEntity = Planora.Auth.Domain.Entities.RefreshToken;

namespace Planora.UnitTests.Services.AuthApi.Users.Handlers;

public sealed class UserQueryHandlerTests
{
    [Fact]
    [Trait("TestType", "Functional")]
    [Trait("TestType", "Regression")]
    public async Task GetUser_ShouldReturnDetailsWithRecentLoginsAndHandleMissingOrRepositoryErrors()
    {
        var user = CreateUser("details@example.com", "Detail", "User");
        var login = new LoginHistory(user.Id, "127.0.0.1", "Chrome", true);
        var detailDto = new UserDetailDto { Id = user.Id, Email = user.Email.Value, FirstName = user.FirstName, LastName = user.LastName };
        var loginDto = new LoginHistoryDto { Id = login.Id, IpAddress = login.IpAddress, UserAgent = login.UserAgent };
        var users = new Mock<IUserRepository>();
        var logins = new Mock<ILoginHistoryRepository>();
        var mapper = new Mock<IMapper>();
        users.Setup(x => x.GetByIdAsync(user.Id, It.IsAny<CancellationToken>())).ReturnsAsync(user);
        users.Setup(x => x.GetByIdAsync(Guid.Empty, It.IsAny<CancellationToken>())).ReturnsAsync((User?)null);
        users.Setup(x => x.GetByIdAsync(It.Is<Guid>(id => id != user.Id && id != Guid.Empty), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("users unavailable"));
        logins.Setup(x => x.GetByUserIdAsync(user.Id, 10, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new[] { login });
        mapper.Setup(x => x.Map<UserDetailDto>(user)).Returns(detailDto);
        mapper.Setup(x => x.Map<List<LoginHistoryDto>>(It.IsAny<IReadOnlyList<LoginHistory>>()))
            .Returns(new List<LoginHistoryDto> { loginDto });
        var handler = new GetUserQueryHandler(
            users.Object,
            logins.Object,
            mapper.Object,
            Mock.Of<ILogger<GetUserQueryHandler>>());

        var success = await handler.Handle(new GetUserQuery(user.Id), CancellationToken.None);
        var missing = await handler.Handle(new GetUserQuery(Guid.Empty), CancellationToken.None);
        var failed = await handler.Handle(new GetUserQuery(Guid.NewGuid()), CancellationToken.None);

        Assert.True(success.IsSuccess);
        Assert.Equal(user.Id, success.Value!.Id);
        Assert.Equal(loginDto.Id, Assert.Single(success.Value.RecentLogins).Id);
        Assert.True(missing.IsFailure);
        Assert.Equal("USER_NOT_FOUND", missing.Error!.Code);
        Assert.True(failed.IsFailure);
        Assert.Equal("GET_USER_ERROR", failed.Error!.Code);
    }

    [Fact]
    [Trait("TestType", "Functional")]
    [Trait("TestType", "Regression")]
    public async Task GetCurrentUser_ShouldRequireAuthenticationMapUserAndReturnFailures()
    {
        var user = CreateUser("current@example.com", "Current", "User");
        var dto = new UserDto { Id = user.Id, Email = user.Email.Value };
        var users = new Mock<IUserRepository>();
        var currentUser = new Mock<ICurrentUserService>();
        var mapper = new Mock<IMapper>();
        currentUser.SetupGet(x => x.UserId).Returns(user.Id);
        users.SetupSequence(x => x.GetByIdAsync(user.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(user)
            .ReturnsAsync((User?)null)
            .ThrowsAsync(new InvalidOperationException("current user lookup failed"));
        mapper.Setup(x => x.Map<UserDto>(user)).Returns(dto);
        var handler = new GetCurrentUserQueryHandler(
            users.Object,
            currentUser.Object,
            mapper.Object,
            Mock.Of<ILogger<GetCurrentUserQueryHandler>>());

        var success = await handler.Handle(new GetCurrentUserQuery(), CancellationToken.None);
        var missing = await handler.Handle(new GetCurrentUserQuery(), CancellationToken.None);
        var failed = await handler.Handle(new GetCurrentUserQuery(), CancellationToken.None);

        Assert.True(success.IsSuccess);
        Assert.Same(dto, success.Value);
        Assert.True(missing.IsFailure);
        Assert.Equal("USER_NOT_FOUND", missing.Error!.Code);
        Assert.True(failed.IsFailure);
        Assert.Equal("GET_CURRENT_USER_ERROR", failed.Error!.Code);

        var unauthenticatedCurrentUser = new Mock<ICurrentUserService>();
        unauthenticatedCurrentUser.SetupGet(x => x.UserId).Returns((Guid?)null);
        var unauthenticatedHandler = new GetCurrentUserQueryHandler(
            users.Object,
            unauthenticatedCurrentUser.Object,
            mapper.Object,
            Mock.Of<ILogger<GetCurrentUserQueryHandler>>());

        var unauthenticated = await unauthenticatedHandler.Handle(new GetCurrentUserQuery(), CancellationToken.None);

        Assert.True(unauthenticated.IsFailure);
        Assert.Equal("NOT_AUTHENTICATED", unauthenticated.Error!.Code);
    }

    [Fact]
    [Trait("TestType", "Functional")]
    [Trait("TestType", "Regression")]
    public async Task GetUserSessions_ShouldMarkCurrentSessionAndHandleAuthenticationAndRepositoryFailures()
    {
        var userId = Guid.NewGuid();
        var activeTokens = new[]
        {
            new RefreshTokenEntity(userId, "current", "127.0.0.1", DateTime.UtcNow.AddDays(1)),
            new RefreshTokenEntity(userId, "other", "10.0.0.2", DateTime.UtcNow.AddDays(1))
        };
        var sessions = new List<SessionDto>
        {
            new() { Id = activeTokens[0].Id, IpAddress = "127.0.0.1" },
            new() { Id = activeTokens[1].Id, IpAddress = "10.0.0.2" }
        };
        var tokens = new Mock<IRefreshTokenRepository>();
        var currentUser = new Mock<ICurrentUserService>();
        var mapper = new Mock<IMapper>();
        currentUser.SetupGet(x => x.UserId).Returns(userId);
        currentUser.SetupGet(x => x.IpAddress).Returns("127.0.0.1");
        tokens.SetupSequence(x => x.GetActiveTokensByUserIdAsync(userId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(activeTokens)
            .ThrowsAsync(new InvalidOperationException("token store unavailable"));
        mapper.Setup(x => x.Map<List<SessionDto>>(It.IsAny<IReadOnlyList<RefreshTokenEntity>>())).Returns(sessions);
        var handler = new GetUserSessionsQueryHandler(
            tokens.Object,
            currentUser.Object,
            mapper.Object,
            Mock.Of<ILogger<GetUserSessionsQueryHandler>>());

        var success = await handler.Handle(new GetUserSessionsQuery(), CancellationToken.None);
        var failed = await handler.Handle(new GetUserSessionsQuery(), CancellationToken.None);

        Assert.True(success.IsSuccess);
        Assert.True(success.Value!.Single(session => session.IpAddress == "127.0.0.1").IsCurrent);
        Assert.False(success.Value!.Single(session => session.IpAddress == "10.0.0.2").IsCurrent);
        Assert.True(failed.IsFailure);
        Assert.Equal("GET_SESSIONS_ERROR", failed.Error!.Code);

        var anonymous = new Mock<ICurrentUserService>();
        anonymous.SetupGet(x => x.UserId).Returns((Guid?)null);
        var anonymousHandler = new GetUserSessionsQueryHandler(
            tokens.Object,
            anonymous.Object,
            mapper.Object,
            Mock.Of<ILogger<GetUserSessionsQueryHandler>>());

        var unauthenticated = await anonymousHandler.Handle(new GetUserSessionsQuery(), CancellationToken.None);

        Assert.True(unauthenticated.IsFailure);
        Assert.Equal("NOT_AUTHENTICATED", unauthenticated.Error!.Code);
    }

    [Fact]
    [Trait("TestType", "Functional")]
    [Trait("TestType", "Regression")]
    public async Task GetUserStatistics_ShouldAggregateStatusSecurityAndCreatedDateBuckets()
    {
        var activeToday = CreateUser("active@example.com", "Active", "Today");
        activeToday.EnableTwoFactor("secret");
        var inactiveThisWeek = CreateUser("inactive@example.com", "Inactive", "Week");
        inactiveThisWeek.Deactivate(inactiveThisWeek.Id);
        SetCreatedAt(inactiveThisWeek, DateTime.UtcNow.AddDays(-3));
        var lockedThisMonth = CreateUser("locked@example.com", "Locked", "Month");
        lockedThisMonth.Lock(lockedThisMonth.Id);
        SetCreatedAt(lockedThisMonth, DateTime.UtcNow.AddDays(-10));
        var oldPending = User.Create(AuthEmail.Create("pending@example.com"), "hash", "Pending", "Old");
        oldPending.ClearDomainEvents();
        SetCreatedAt(oldPending, DateTime.UtcNow.AddMonths(-2));
        var users = new Mock<IUserRepository>();
        users.Setup(x => x.GetAllAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(new[] { activeToday, inactiveThisWeek, lockedThisMonth, oldPending });
        var handler = new GetUserStatisticsQueryHandler(
            users.Object,
            Mock.Of<ILogger<GetUserStatisticsQueryHandler>>());

        var result = await handler.Handle(new GetUserStatisticsQuery(), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(4, result.Value!.TotalUsers);
        Assert.Equal(1, result.Value.ActiveUsers);
        Assert.Equal(1, result.Value.InactiveUsers);
        Assert.Equal(1, result.Value.LockedUsers);
        Assert.Equal(1, result.Value.UsersWithTwoFactor);
        Assert.Equal(1, result.Value.NewUsersToday);
        Assert.Equal(2, result.Value.NewUsersThisWeek);
        Assert.Equal(3, result.Value.NewUsersThisMonth);
        Assert.True(result.Value.LastUpdated <= DateTime.UtcNow);
    }

    [Fact]
    [Trait("TestType", "Resilience")]
    [Trait("TestType", "Regression")]
    public async Task GetUserStatistics_ShouldReturnInternalFailureWhenRepositoryThrows()
    {
        var users = new Mock<IUserRepository>();
        users.Setup(x => x.GetAllAsync(It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("statistics unavailable"));
        var handler = new GetUserStatisticsQueryHandler(
            users.Object,
            Mock.Of<ILogger<GetUserStatisticsQueryHandler>>());

        var result = await handler.Handle(new GetUserStatisticsQuery(), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("GET_STATS_ERROR", result.Error!.Code);
    }

    private static User CreateUser(string email, string firstName, string lastName)
    {
        var user = User.Create(AuthEmail.Create(email), "hashed-password", firstName, lastName);
        user.VerifyEmail();
        user.ClearDomainEvents();
        return user;
    }

    private static void SetCreatedAt(User user, DateTime createdAt)
    {
        typeof(BaseEntity)
            .GetProperty(nameof(BaseEntity.CreatedAt))!
            .SetValue(user, createdAt);
    }
}
