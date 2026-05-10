using System.Reflection;
using Planora.Auth.Application.Common.Interfaces;
using Planora.Auth.Application.Features.Authentication.Commands.Login;
using Planora.Auth.Application.Features.Authentication.Handlers.Login;
using Planora.Auth.Domain.Entities;
using Planora.Auth.Domain.Repositories;
using Planora.Auth.Domain.ValueObjects;
using Planora.BuildingBlocks.Application.Services;
using Planora.BuildingBlocks.Domain.Exceptions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Moq;

namespace Planora.UnitTests.Services.AuthApi.Authentication.Handlers;

public sealed class LoginCommandHandlerTests
{
    [Fact]
    [Trait("TestType", "Security")]
    [Trait("TestType", "Regression")]
    public async Task Handle_ShouldRejectMissingReloadedUserAndLockedAccount()
    {
        var missing = CreateFixture();
        missing.Users
            .Setup(x => x.GetByEmailAsync(Email.Create("missing@example.com"), It.IsAny<CancellationToken>()))
            .ReturnsAsync((User?)null);

        await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
            missing.Handler.Handle(
                new LoginCommand { Email = "missing@example.com", Password = "Password123!" },
                CancellationToken.None));

        var staleUser = CreateUser("stale@example.com");
        var stale = CreateFixture();
        stale.Users.Setup(x => x.GetByEmailAsync(staleUser.Email, It.IsAny<CancellationToken>())).ReturnsAsync(staleUser);
        stale.Users.Setup(x => x.GetWithRefreshTokensAsync(staleUser.Id, It.IsAny<CancellationToken>())).ReturnsAsync((User?)null);

        await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
            stale.Handler.Handle(
                new LoginCommand { Email = staleUser.Email.Value, Password = "Password123!" },
                CancellationToken.None));

        var lockedUser = CreateUser("locked-login@example.com");
        lockedUser.LockAccount();
        var locked = CreateFixture();
        locked.Users.Setup(x => x.GetByEmailAsync(lockedUser.Email, It.IsAny<CancellationToken>())).ReturnsAsync(lockedUser);
        locked.Users.Setup(x => x.GetWithRefreshTokensAsync(lockedUser.Id, It.IsAny<CancellationToken>())).ReturnsAsync(lockedUser);

        await Assert.ThrowsAsync<ForbiddenException>(() =>
            locked.Handler.Handle(
                new LoginCommand { Email = lockedUser.Email.Value, Password = "Password123!" },
                CancellationToken.None));

        locked.PasswordHasher.Verify(x => x.VerifyPassword(It.IsAny<string>(), It.IsAny<string>()), Times.Never);
    }

    [Fact]
    [Trait("TestType", "Security")]
    [Trait("TestType", "Regression")]
    public async Task Handle_ShouldRecordFailedLogin_WhenPasswordIsInvalid()
    {
        var user = CreateUser("bad-password@example.com");
        var fixture = CreateFixture();
        fixture.SetupUserReload(user);
        fixture.PasswordHasher.Setup(x => x.VerifyPassword("wrong", user.PasswordHash)).Returns(false);
        fixture.LoginHistory
            .Setup(x => x.AddAsync(It.IsAny<LoginHistory>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((LoginHistory history, CancellationToken _) => history);
        fixture.UnitOfWork.Setup(x => x.SaveChangesAsync(It.IsAny<CancellationToken>())).ReturnsAsync(1);

        await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
            fixture.Handler.Handle(
                new LoginCommand { Email = user.Email.Value, Password = "wrong" },
                CancellationToken.None));

        fixture.Users.Verify(x => x.HandleFailedLoginAsync(user.Id, It.IsAny<CancellationToken>()), Times.Once);
        fixture.LoginHistory.Verify(x => x.AddAsync(
            It.Is<LoginHistory>(history => !history.IsSuccessful && history.FailureReason == "Invalid password"),
            It.IsAny<CancellationToken>()), Times.Once);
        fixture.UnitOfWork.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    [Trait("TestType", "Security")]
    [Trait("TestType", "Regression")]
    public async Task Handle_ShouldRequireAndValidateTwoFactorCode()
    {
        var user = CreateUser("two-factor@example.com");
        user.EnableTwoFactor("SECRET");
        var missingCode = CreateFixture();
        missingCode.SetupUserReload(user);
        missingCode.PasswordHasher.Setup(x => x.VerifyPassword("Password123!", user.PasswordHash)).Returns(true);

        await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
            missingCode.Handler.Handle(
                new LoginCommand { Email = user.Email.Value, Password = "Password123!" },
                CancellationToken.None));

        var invalidCode = CreateFixture();
        invalidCode.SetupUserReload(user);
        invalidCode.PasswordHasher.Setup(x => x.VerifyPassword("Password123!", user.PasswordHash)).Returns(true);
        invalidCode.TwoFactorService.Setup(x => x.VerifyCode("SECRET", "000000")).Returns(false);
        invalidCode.LoginHistory
            .Setup(x => x.AddAsync(It.IsAny<LoginHistory>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((LoginHistory history, CancellationToken _) => history);
        invalidCode.UnitOfWork.Setup(x => x.SaveChangesAsync(It.IsAny<CancellationToken>())).ReturnsAsync(1);

        await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
            invalidCode.Handler.Handle(
                new LoginCommand { Email = user.Email.Value, Password = "Password123!", TwoFactorCode = "000000" },
                CancellationToken.None));

        invalidCode.Users.Verify(x => x.HandleFailedLoginAsync(user.Id, It.IsAny<CancellationToken>()), Times.Once);
        invalidCode.LoginHistory.Verify(x => x.AddAsync(
            It.Is<LoginHistory>(history => !history.IsSuccessful && history.FailureReason == "Invalid two-factor authentication code"),
            It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    [Trait("TestType", "Functional")]
    [Trait("TestType", "Integration")]
    [Trait("TestType", "Regression")]
    public async Task Handle_ShouldIssueTokensCreateRefreshSessionAndWriteAuditHistory()
    {
        var user = CreateUser("login-success@example.com");
        var fixture = CreateFixture("Chrome", "10.0.0.1");
        RefreshToken? addedRefreshToken = null;
        fixture.SetupUserReload(user);
        fixture.PasswordHasher.Setup(x => x.VerifyPassword("Password123!", user.PasswordHash)).Returns(true);
        fixture.TokenService.Setup(x => x.GenerateAccessToken(user)).Returns("access-token");
        fixture.TokenService.Setup(x => x.GenerateRefreshToken()).Returns("refresh-token");
        fixture.TokenService.Setup(x => x.GetRefreshTokenLifetime()).Returns(TimeSpan.FromDays(7));
        fixture.RefreshTokens
            .Setup(x => x.FindActiveByUserAndDeviceAsync(user.Id, It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((RefreshToken?)null);
        fixture.RefreshTokens
            .Setup(x => x.AddAsync(It.IsAny<RefreshToken>(), It.IsAny<CancellationToken>()))
            .Callback<RefreshToken, CancellationToken>((token, _) => addedRefreshToken = token)
            .ReturnsAsync((RefreshToken token, CancellationToken _) => token);
        fixture.LoginHistory
            .Setup(x => x.AddAsync(It.IsAny<LoginHistory>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((LoginHistory history, CancellationToken _) => history);
        fixture.UnitOfWork.Setup(x => x.SaveChangesAsync(It.IsAny<CancellationToken>())).ReturnsAsync(1);

        var result = await fixture.Handler.Handle(
            new LoginCommand { Email = user.Email.Value, Password = "Password123!" },
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(user.Id, result.Value!.UserId);
        Assert.Equal("access-token", result.Value.AccessToken);
        Assert.Equal("refresh-token", result.Value.RefreshToken);
        Assert.NotNull(addedRefreshToken);
        Assert.Equal("Chrome", addedRefreshToken!.DeviceName);
        Assert.Equal("10.0.0.1", addedRefreshToken.CreatedByIp);
        fixture.UnitOfWork.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Exactly(2));
        fixture.LoginHistory.Verify(x => x.AddAsync(
            It.Is<LoginHistory>(history => history.IsSuccessful),
            It.IsAny<CancellationToken>()), Times.Once);
        fixture.BusinessLogger.Verify(x => x.LogBusinessEvent(
            BusinessEvents.UserLoggedIn,
            It.IsAny<string>(),
            It.IsAny<object>(),
            user.Id.ToString()), Times.Once);
    }

    [Fact]
    [Trait("TestType", "Functional")]
    [Trait("TestType", "Regression")]
    public async Task Handle_ShouldReuseExistingDeviceRefreshTokenAndContinue_WhenAuditHistoryFails()
    {
        var user = CreateUser("reuse-token@example.com");
        var existingToken = new RefreshToken(user.Id, "old-refresh", "old-ip", DateTime.UtcNow.AddDays(7));
        var fixture = CreateFixture("Mobile Safari", "10.0.0.2");
        fixture.SetupUserReload(user);
        fixture.PasswordHasher.Setup(x => x.VerifyPassword("Password123!", user.PasswordHash)).Returns(true);
        fixture.TokenService.Setup(x => x.GenerateAccessToken(user)).Returns("access-token");
        fixture.TokenService.Setup(x => x.GenerateRefreshToken()).Returns("new-refresh");
        fixture.RefreshTokens
            .Setup(x => x.FindActiveByUserAndDeviceAsync(user.Id, It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(existingToken);
        fixture.LoginHistory
            .Setup(x => x.AddAsync(It.IsAny<LoginHistory>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("audit unavailable"));
        fixture.UnitOfWork.Setup(x => x.SaveChangesAsync(It.IsAny<CancellationToken>())).ReturnsAsync(1);

        var result = await fixture.Handler.Handle(
            new LoginCommand { Email = user.Email.Value, Password = "Password123!", RememberMe = true },
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal("new-refresh", existingToken.Token);
        Assert.True(existingToken.RememberMe);
        Assert.Equal("10.0.0.2", existingToken.CreatedByIp);
        Assert.True(result.Value!.ExpiresAt > DateTime.UtcNow.AddDays(29));
        fixture.RefreshTokens.Verify(x => x.Update(existingToken), Times.Once);
        fixture.RefreshTokens.Verify(x => x.AddAsync(It.IsAny<RefreshToken>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    [Trait("TestType", "Resilience")]
    [Trait("TestType", "Regression")]
    public async Task Handle_ShouldRethrowConcurrencyErrorsDuringPrimaryLoginCommit()
    {
        var user = CreateUser("login-concurrency@example.com");
        var fixture = CreateFixture();
        ConfigureSuccessfulCredentialAndTokenFlow(fixture, user);
        fixture.UnitOfWork
            .Setup(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()))
            .ThrowsAsync(new DbUpdateConcurrencyException("concurrency"));

        var exception = await Assert.ThrowsAsync<DbUpdateConcurrencyException>(() =>
            fixture.Handler.Handle(
                new LoginCommand { Email = user.Email.Value, Password = "Password123!" },
                CancellationToken.None));

        Assert.Equal("concurrency", exception.Message);
        fixture.LoginHistory.Verify(
            x => x.AddAsync(It.IsAny<LoginHistory>(), It.IsAny<CancellationToken>()),
            Times.Never);
    }

    [Fact]
    [Trait("TestType", "Resilience")]
    [Trait("TestType", "Regression")]
    public async Task Handle_ShouldRethrowUnexpectedErrorsDuringPrimaryLoginCommit()
    {
        var user = CreateUser("login-save-error@example.com");
        var fixture = CreateFixture();
        ConfigureSuccessfulCredentialAndTokenFlow(fixture, user);
        fixture.UnitOfWork
            .Setup(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("primary save failed"));

        var exception = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            fixture.Handler.Handle(
                new LoginCommand { Email = user.Email.Value, Password = "Password123!" },
                CancellationToken.None));

        Assert.Equal("primary save failed", exception.Message);
        fixture.LoginHistory.Verify(
            x => x.AddAsync(It.IsAny<LoginHistory>(), It.IsAny<CancellationToken>()),
            Times.Never);
    }

    [Fact]
    [Trait("TestType", "Unit")]
    [Trait("TestType", "Regression")]
    public void DeviceHelpers_ShouldProduceDeterministicFingerprintAndKnownDeviceNames()
    {
        var type = typeof(LoginCommandHandler);
        var fingerprintMethod = type.GetMethod("ComputeDeviceFingerprint", BindingFlags.NonPublic | BindingFlags.Static)!;
        var parseMethod = type.GetMethod("ParseDeviceName", BindingFlags.NonPublic | BindingFlags.Static)!;

        var first = (string)fingerprintMethod.Invoke(null, new object[] { "Chrome", "127.0.0.1" })!;
        var second = (string)fingerprintMethod.Invoke(null, new object[] { "Chrome", "127.0.0.1" })!;
        var different = (string)fingerprintMethod.Invoke(null, new object[] { "Firefox", "127.0.0.1" })!;

        Assert.Equal(64, first.Length);
        Assert.Equal(first, second);
        Assert.NotEqual(first, different);
        Assert.Equal("Unknown Device", parseMethod.Invoke(null, new object?[] { null }));
        Assert.Equal("Mobile Browser", parseMethod.Invoke(null, new object?[] { "Mobile Safari" }));
        Assert.Equal("Chrome", parseMethod.Invoke(null, new object?[] { "Chrome" }));
        Assert.Equal("Firefox", parseMethod.Invoke(null, new object?[] { "Firefox" }));
        Assert.Equal("Safari", parseMethod.Invoke(null, new object?[] { "Safari" }));
        Assert.Equal("Browser", parseMethod.Invoke(null, new object?[] { "Edge" }));
    }

    private static Fixture CreateFixture(string userAgent = "Chrome", string ipAddress = "127.0.0.1")
    {
        var unitOfWork = new Mock<IAuthUnitOfWork>();
        var users = new Mock<IUserRepository>();
        var refreshTokens = new Mock<IRefreshTokenRepository>();
        var loginHistory = new Mock<ILoginHistoryRepository>();
        var passwordHasher = new Mock<IPasswordHasher>();
        var tokenService = new Mock<ITokenService>();
        var twoFactorService = new Mock<ITwoFactorService>();
        var currentUser = new Mock<ICurrentUserService>();
        var businessLogger = new Mock<IBusinessEventLogger>();

        unitOfWork.SetupGet(x => x.Users).Returns(users.Object);
        unitOfWork.SetupGet(x => x.RefreshTokens).Returns(refreshTokens.Object);
        unitOfWork.SetupGet(x => x.LoginHistory).Returns(loginHistory.Object);
        currentUser.SetupGet(x => x.UserAgent).Returns(userAgent);
        currentUser.SetupGet(x => x.IpAddress).Returns(ipAddress);
        tokenService.Setup(x => x.GetRefreshTokenLifetime()).Returns(TimeSpan.FromDays(7));

        return new Fixture(
            unitOfWork,
            users,
            refreshTokens,
            loginHistory,
            passwordHasher,
            tokenService,
            twoFactorService,
            currentUser,
            businessLogger,
            new LoginCommandHandler(
                unitOfWork.Object,
                passwordHasher.Object,
                tokenService.Object,
                twoFactorService.Object,
                currentUser.Object,
                businessLogger.Object,
                Mock.Of<ILogger<LoginCommandHandler>>()));
    }

    private static User CreateUser(string email)
    {
        var user = User.Create(Email.Create(email), "password-hash", "Login", "User");
        user.VerifyEmail();
        user.ClearDomainEvents();
        return user;
    }

    private static void ConfigureSuccessfulCredentialAndTokenFlow(Fixture fixture, User user)
    {
        fixture.SetupUserReload(user);
        fixture.PasswordHasher.Setup(x => x.VerifyPassword("Password123!", user.PasswordHash)).Returns(true);
        fixture.TokenService.Setup(x => x.GenerateAccessToken(user)).Returns("access-token");
        fixture.TokenService.Setup(x => x.GenerateRefreshToken()).Returns("refresh-token");
        fixture.RefreshTokens
            .Setup(x => x.FindActiveByUserAndDeviceAsync(user.Id, It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((RefreshToken?)null);
        fixture.RefreshTokens
            .Setup(x => x.AddAsync(It.IsAny<RefreshToken>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((RefreshToken token, CancellationToken _) => token);
    }

    private sealed record Fixture(
        Mock<IAuthUnitOfWork> UnitOfWork,
        Mock<IUserRepository> Users,
        Mock<IRefreshTokenRepository> RefreshTokens,
        Mock<ILoginHistoryRepository> LoginHistory,
        Mock<IPasswordHasher> PasswordHasher,
        Mock<ITokenService> TokenService,
        Mock<ITwoFactorService> TwoFactorService,
        Mock<ICurrentUserService> CurrentUser,
        Mock<IBusinessEventLogger> BusinessLogger,
        LoginCommandHandler Handler)
    {
        public void SetupUserReload(User user)
        {
            Users.Setup(x => x.GetByEmailAsync(user.Email, It.IsAny<CancellationToken>())).ReturnsAsync(user);
            Users.Setup(x => x.GetWithRefreshTokensAsync(user.Id, It.IsAny<CancellationToken>())).ReturnsAsync(user);
        }
    }
}
