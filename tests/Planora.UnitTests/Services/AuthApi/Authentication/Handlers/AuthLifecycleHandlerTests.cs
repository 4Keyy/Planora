using Planora.Auth.Application.Common.Interfaces;
using Planora.Auth.Application.Common.Options;
using Planora.Auth.Application.Common.Security;
using Planora.Auth.Application.Features.Authentication.Commands.Login;
using Planora.Auth.Application.Features.Authentication.Commands.RefreshToken;
using Planora.Auth.Application.Features.Authentication.Commands.Register;
using Planora.Auth.Application.Features.Authentication.Handlers.Login;
using Planora.Auth.Application.Features.Authentication.Handlers.RefreshToken;
using Planora.Auth.Application.Features.Authentication.Handlers.Register;
using Planora.Auth.Application.Features.Authentication.Handlers.ValidateToken;
using Planora.Auth.Application.Features.Authentication.Queries.ValidateToken;
using Planora.Auth.Application.Features.Authentication.Response.Login;
using Planora.Auth.Domain.Entities;
using Planora.Auth.Domain.Enums;
using Planora.Auth.Domain.Repositories;
using Planora.Auth.Domain.ValueObjects;
using Planora.BuildingBlocks.Application.Services;
using Planora.BuildingBlocks.Domain.Exceptions;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Moq;
using RefreshTokenEntity = Planora.Auth.Domain.Entities.RefreshToken;

namespace Planora.UnitTests.Services.AuthApi.Authentication.Handlers;

public class AuthLifecycleHandlerTests
{
    [Fact]
    public async Task Register_ShouldCreateUserStoreHashedEmailToken_AndContinueWhenEmailFails()
    {
        var fixture = new AuthFixture();
        User? addedUser = null;
        string? verificationLink = null;

        fixture.Users
            .Setup(x => x.GetByEmailAsync(It.IsAny<Email>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((User?)null);
        fixture.Users
            .Setup(x => x.AddAsync(It.IsAny<User>(), It.IsAny<CancellationToken>()))
            .Callback<User, CancellationToken>((user, _) => addedUser = user)
            .ReturnsAsync((User user, CancellationToken _) => user);
        fixture.PasswordHasher.Setup(x => x.HashPassword("Password123!")).Returns("hashed-password");
        fixture.TokenService.Setup(x => x.GenerateAccessToken(It.IsAny<User>())).Returns("access-token");
        fixture.TokenService.Setup(x => x.GenerateRefreshToken()).Returns("refresh-token");
        fixture.TokenService.Setup(x => x.GetRefreshTokenLifetime()).Returns(TimeSpan.FromDays(7));
        fixture.EmailService
            .Setup(x => x.SendEmailVerificationAsync(
                "new@example.com",
                "Ada",
                It.IsAny<string>(),
                It.IsAny<CancellationToken>()))
            .Callback<string, string, string, CancellationToken>((_, _, link, _) => verificationLink = link)
            .ThrowsAsync(new InvalidOperationException("smtp down"));

        var handler = fixture.CreateRegisterHandler();

        var result = await handler.Handle(
            new RegisterCommand
            {
                Email = "new@example.com",
                Password = "Password123!",
                ConfirmPassword = "Password123!",
                FirstName = " Ada ",
                LastName = " Lovelace "
            },
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal("access-token", result.Value!.AccessToken);
        Assert.Equal("refresh-token", result.Value.RefreshToken);
        Assert.NotNull(addedUser);
        Assert.Equal("hashed-password", addedUser!.PasswordHash);
        Assert.Equal("Ada", addedUser.FirstName);
        Assert.Equal("Lovelace", addedUser.LastName);
        Assert.NotNull(addedUser.EmailVerificationToken);
        Assert.DoesNotContain("verify-email?token=", addedUser.EmailVerificationToken);
        Assert.NotNull(verificationLink);
        Assert.StartsWith("https://app.example.com/auth/verify-email?token=", verificationLink);
        Assert.Equal(OpaqueToken.Hash(new Uri(verificationLink!).Query.TrimStart('?').Split('=')[1]), addedUser.EmailVerificationToken);

        fixture.UnitOfWork.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Once);
        fixture.BusinessLogger.Verify(
            x => x.LogBusinessEvent(
                BusinessEvents.UserRegistered,
                It.IsAny<string>(),
                It.IsAny<object>(),
                addedUser.Id.ToString()),
            Times.Once);
    }

    [Fact]
    public async Task Register_ShouldThrowDuplicate_WhenEmailExists()
    {
        var fixture = new AuthFixture();
        fixture.Users
            .Setup(x => x.GetByEmailAsync(It.IsAny<Email>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(CreateUser());

        var handler = fixture.CreateRegisterHandler();

        await Assert.ThrowsAsync<DuplicateEntityException>(() =>
            handler.Handle(
                new RegisterCommand
                {
                    Email = "user@example.com",
                    Password = "Password123!",
                    ConfirmPassword = "Password123!",
                    FirstName = "First",
                    LastName = "Last"
                },
                CancellationToken.None));

        fixture.Users.Verify(x => x.AddAsync(It.IsAny<User>(), It.IsAny<CancellationToken>()), Times.Never);
        fixture.UnitOfWork.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    [Trait("TestType", "Resilience")]
    [Trait("TestType", "Regression")]
    public async Task Register_ShouldRethrowPersistenceFailuresAfterLoggingSaveError()
    {
        var fixture = new AuthFixture();
        fixture.Users
            .Setup(x => x.GetByEmailAsync(It.IsAny<Email>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((User?)null);
        fixture.Users
            .Setup(x => x.AddAsync(It.IsAny<User>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((User user, CancellationToken _) => user);
        fixture.PasswordHasher.Setup(x => x.HashPassword("Password123!")).Returns("hashed-password");
        fixture.TokenService.Setup(x => x.GenerateAccessToken(It.IsAny<User>())).Returns("access-token");
        fixture.TokenService.Setup(x => x.GenerateRefreshToken()).Returns("refresh-token");
        fixture.TokenService.Setup(x => x.GetRefreshTokenLifetime()).Returns(TimeSpan.FromDays(7));
        fixture.UnitOfWork
            .Setup(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("database write failed"));

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            fixture.CreateRegisterHandler().Handle(
                new RegisterCommand
                {
                    Email = "new@example.com",
                    Password = "Password123!",
                    ConfirmPassword = "Password123!",
                    FirstName = "Ada",
                    LastName = "Lovelace"
                },
                CancellationToken.None));

        fixture.EmailService.Verify(
            x => x.SendEmailVerificationAsync(
                It.IsAny<string>(),
                It.IsAny<string>(),
                It.IsAny<string>(),
                It.IsAny<CancellationToken>()),
            Times.Never);
    }

    [Fact]
    [Trait("TestType", "Functional")]
    [Trait("TestType", "Regression")]
    public async Task Register_ShouldSendVerificationEmail_WhenEmailServiceSucceeds()
    {
        var fixture = new AuthFixture();
        fixture.Users
            .Setup(x => x.GetByEmailAsync(It.IsAny<Email>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((User?)null);
        fixture.Users
            .Setup(x => x.AddAsync(It.IsAny<User>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((User user, CancellationToken _) => user);
        fixture.PasswordHasher.Setup(x => x.HashPassword("Password123!")).Returns("hashed-password");
        fixture.TokenService.Setup(x => x.GenerateAccessToken(It.IsAny<User>())).Returns("access-token");
        fixture.TokenService.Setup(x => x.GenerateRefreshToken()).Returns("refresh-token");
        fixture.TokenService.Setup(x => x.GetRefreshTokenLifetime()).Returns(TimeSpan.FromDays(7));
        fixture.EmailService
            .Setup(x => x.SendEmailVerificationAsync(
                "new@example.com",
                "Ada",
                It.IsAny<string>(),
                It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);

        var result = await fixture.CreateRegisterHandler().Handle(
            new RegisterCommand
            {
                Email = "new@example.com",
                Password = "Password123!",
                ConfirmPassword = "Password123!",
                FirstName = "Ada",
                LastName = "Lovelace"
            },
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        fixture.EmailService.Verify(
            x => x.SendEmailVerificationAsync(
                "new@example.com",
                "Ada",
                It.IsAny<string>(),
                It.IsAny<CancellationToken>()),
            Times.Once);
    }


    [Fact]
    public async Task Login_ShouldCreateRefreshSession_RecordHistory_AndLogBusinessEvent()
    {
        var fixture = new AuthFixture();
        var user = CreateUser();
        RefreshTokenEntity? addedRefreshToken = null;
        LoginHistory? loginHistory = null;

        fixture.Users.Setup(x => x.GetByEmailAsync(It.IsAny<Email>(), It.IsAny<CancellationToken>())).ReturnsAsync(user);
        fixture.Users.Setup(x => x.GetWithRefreshTokensAsync(user.Id, It.IsAny<CancellationToken>())).ReturnsAsync(user);
        fixture.PasswordHasher.Setup(x => x.VerifyPassword("Password123!", user.PasswordHash)).Returns(true);
        fixture.TokenService.Setup(x => x.GenerateAccessToken(user)).Returns("access-token");
        fixture.TokenService.Setup(x => x.GenerateRefreshToken()).Returns("refresh-token");
        fixture.TokenService.Setup(x => x.GetRefreshTokenLifetime()).Returns(TimeSpan.FromDays(7));
        fixture.RefreshTokens.Setup(x => x.FindActiveByUserAndDeviceAsync(user.Id, It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((RefreshTokenEntity?)null);
        fixture.RefreshTokens.Setup(x => x.AddAsync(It.IsAny<RefreshTokenEntity>(), It.IsAny<CancellationToken>()))
            .Callback<RefreshTokenEntity, CancellationToken>((token, _) => addedRefreshToken = token)
            .ReturnsAsync((RefreshTokenEntity token, CancellationToken _) => token);
        fixture.LoginHistory.Setup(x => x.AddAsync(It.IsAny<LoginHistory>(), It.IsAny<CancellationToken>()))
            .Callback<LoginHistory, CancellationToken>((history, _) => loginHistory = history)
            .ReturnsAsync((LoginHistory history, CancellationToken _) => history);

        var result = await fixture.CreateLoginHandler().Handle(
            new LoginCommand
            {
                Email = user.Email.Value,
                Password = "Password123!",
                RememberMe = true
            },
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal("access-token", result.Value!.AccessToken);
        Assert.Equal("refresh-token", result.Value.RefreshToken);
        Assert.True(result.Value.ExpiresAt > DateTime.UtcNow.AddDays(29));
        Assert.NotNull(addedRefreshToken);
        Assert.True(addedRefreshToken!.RememberMe);
        Assert.Equal("Chrome", addedRefreshToken.DeviceName);
        Assert.NotNull(addedRefreshToken.DeviceFingerprint);
        Assert.NotNull(loginHistory);
        Assert.True(loginHistory!.IsSuccessful);
        Assert.Equal("127.0.0.1", loginHistory.IpAddress);
        fixture.UnitOfWork.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Exactly(2));
        fixture.BusinessLogger.Verify(
            x => x.LogBusinessEvent(
                BusinessEvents.UserLoggedIn,
                It.IsAny<string>(),
                It.IsAny<object>(),
                user.Id.ToString()),
            Times.Once);
    }

    [Fact]
    public async Task Login_ShouldReuseExistingDeviceSession_WhenFingerprintMatches()
    {
        var fixture = new AuthFixture();
        var user = CreateUser();
        var existing = new RefreshTokenEntity(
            user.Id,
            "old-token",
            "127.0.0.1",
            DateTime.UtcNow.AddDays(1),
            false,
            "fingerprint",
            "Chrome");

        fixture.Users.Setup(x => x.GetByEmailAsync(It.IsAny<Email>(), It.IsAny<CancellationToken>())).ReturnsAsync(user);
        fixture.Users.Setup(x => x.GetWithRefreshTokensAsync(user.Id, It.IsAny<CancellationToken>())).ReturnsAsync(user);
        fixture.PasswordHasher.Setup(x => x.VerifyPassword("Password123!", user.PasswordHash)).Returns(true);
        fixture.TokenService.Setup(x => x.GenerateAccessToken(user)).Returns("access-token");
        fixture.TokenService.Setup(x => x.GenerateRefreshToken()).Returns("new-token");
        fixture.TokenService.Setup(x => x.GetRefreshTokenLifetime()).Returns(TimeSpan.FromDays(7));
        fixture.RefreshTokens.Setup(x => x.FindActiveByUserAndDeviceAsync(user.Id, It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(existing);

        var result = await fixture.CreateLoginHandler().Handle(
            new LoginCommand
            {
                Email = user.Email.Value,
                Password = "Password123!",
                RememberMe = false
            },
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal("new-token", existing.Token);
        Assert.False(existing.RememberMe);
        Assert.Equal(2, existing.LoginCount);
        fixture.RefreshTokens.Verify(x => x.Update(existing), Times.Once);
        fixture.RefreshTokens.Verify(x => x.AddAsync(It.IsAny<RefreshTokenEntity>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Login_ShouldAuditFailedPassword_AndThrowUnauthorized()
    {
        var fixture = new AuthFixture();
        var user = CreateUser();
        LoginHistory? failedHistory = null;

        fixture.Users.Setup(x => x.GetByEmailAsync(It.IsAny<Email>(), It.IsAny<CancellationToken>())).ReturnsAsync(user);
        fixture.Users.Setup(x => x.GetWithRefreshTokensAsync(user.Id, It.IsAny<CancellationToken>())).ReturnsAsync(user);
        fixture.PasswordHasher.Setup(x => x.VerifyPassword("wrong", user.PasswordHash)).Returns(false);
        fixture.LoginHistory.Setup(x => x.AddAsync(It.IsAny<LoginHistory>(), It.IsAny<CancellationToken>()))
            .Callback<LoginHistory, CancellationToken>((history, _) => failedHistory = history)
            .ReturnsAsync((LoginHistory history, CancellationToken _) => history);

        await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
            fixture.CreateLoginHandler().Handle(
                new LoginCommand { Email = user.Email.Value, Password = "wrong" },
                CancellationToken.None));

        fixture.Users.Verify(x => x.HandleFailedLoginAsync(user.Id, It.IsAny<CancellationToken>()), Times.Once);
        Assert.NotNull(failedHistory);
        Assert.False(failedHistory!.IsSuccessful);
        Assert.Equal("Invalid password", failedHistory.FailureReason);
        fixture.UnitOfWork.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Login_ShouldRequireAndValidateTwoFactorCode()
    {
        var fixture = new AuthFixture();
        var user = CreateUser();
        user.EnableTwoFactor("secret");

        fixture.Users.Setup(x => x.GetByEmailAsync(It.IsAny<Email>(), It.IsAny<CancellationToken>())).ReturnsAsync(user);
        fixture.Users.Setup(x => x.GetWithRefreshTokensAsync(user.Id, It.IsAny<CancellationToken>())).ReturnsAsync(user);
        fixture.PasswordHasher.Setup(x => x.VerifyPassword("Password123!", user.PasswordHash)).Returns(true);

        await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
            fixture.CreateLoginHandler().Handle(
                new LoginCommand { Email = user.Email.Value, Password = "Password123!" },
                CancellationToken.None));

        fixture.TwoFactorService.Setup(x => x.VerifyCode("secret", "000000")).Returns(false);

        await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
            fixture.CreateLoginHandler().Handle(
                new LoginCommand { Email = user.Email.Value, Password = "Password123!", TwoFactorCode = "000000" },
                CancellationToken.None));

        fixture.Users.Verify(x => x.HandleFailedLoginAsync(user.Id, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task RefreshToken_ShouldRotateActiveToken_AndPreserveRememberMeAndDevice()
    {
        var fixture = new AuthFixture();
        var user = CreateUser();
        var oldToken = new RefreshTokenEntity(
            user.Id,
            "old-refresh-token",
            "127.0.0.1",
            DateTime.UtcNow.AddDays(7),
            true,
            "device-fingerprint",
            "Chrome");
        AddRefreshTokenToUser(user, oldToken);
        RefreshTokenEntity? newToken = null;

        fixture.Users.Setup(x => x.GetByRefreshTokenAsync("old-refresh-token", It.IsAny<CancellationToken>()))
            .ReturnsAsync(user);
        fixture.TokenService.Setup(x => x.GenerateAccessToken(user)).Returns("new-access-token");
        fixture.TokenService.Setup(x => x.GenerateRefreshToken()).Returns("new-refresh-token");
        fixture.TokenService.Setup(x => x.GetRefreshTokenLifetime()).Returns(TimeSpan.FromDays(7));
        fixture.RefreshTokens.Setup(x => x.AddAsync(It.IsAny<RefreshTokenEntity>(), It.IsAny<CancellationToken>()))
            .Callback<RefreshTokenEntity, CancellationToken>((token, _) => newToken = token)
            .ReturnsAsync((RefreshTokenEntity token, CancellationToken _) => token);

        var result = await fixture.CreateRefreshTokenHandler().Handle(
            new RefreshTokenCommand { RefreshToken = "old-refresh-token" },
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal("new-access-token", result.Value!.AccessToken);
        Assert.Equal("new-refresh-token", result.Value.RefreshToken);
        Assert.True(result.Value.RememberMe);
        Assert.False(oldToken.IsActive);
        Assert.NotNull(newToken);
        Assert.True(newToken!.RememberMe);
        Assert.Equal("device-fingerprint", newToken.DeviceFingerprint);
        Assert.Equal("Chrome", newToken.DeviceName);
        fixture.RefreshTokens.Verify(x => x.Update(oldToken), Times.Once);
        fixture.UnitOfWork.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task RefreshToken_ShouldReturnExpectedFailures()
    {
        var fixture = new AuthFixture();
        var handler = fixture.CreateRefreshTokenHandler();

        fixture.Users.Setup(x => x.GetByRefreshTokenAsync("missing", It.IsAny<CancellationToken>()))
            .ReturnsAsync((User?)null);
        var missing = await handler.Handle(new RefreshTokenCommand { RefreshToken = "missing" }, CancellationToken.None);
        Assert.True(missing.IsFailure);
        Assert.Equal("INVALID_REFRESH_TOKEN", missing.Error!.Code);

        var userWithInactive = CreateUser();
        var inactive = new RefreshTokenEntity(userWithInactive.Id, "inactive", "127.0.0.1", DateTime.UtcNow.AddDays(1));
        inactive.Revoke("127.0.0.1", "test");
        AddRefreshTokenToUser(userWithInactive, inactive);
        fixture.Users.Setup(x => x.GetByRefreshTokenAsync("inactive", It.IsAny<CancellationToken>()))
            .ReturnsAsync(userWithInactive);
        var inactiveResult = await handler.Handle(new RefreshTokenCommand { RefreshToken = "inactive" }, CancellationToken.None);
        Assert.True(inactiveResult.IsFailure);
        Assert.Equal("INVALID_REFRESH_TOKEN", inactiveResult.Error!.Code);

        var lockedUser = CreateUser();
        lockedUser.LockAccount();
        var lockedToken = new RefreshTokenEntity(lockedUser.Id, "locked", "127.0.0.1", DateTime.UtcNow.AddDays(1));
        AddRefreshTokenToUser(lockedUser, lockedToken);
        fixture.Users.Setup(x => x.GetByRefreshTokenAsync("locked", It.IsAny<CancellationToken>()))
            .ReturnsAsync(lockedUser);
        var locked = await handler.Handle(new RefreshTokenCommand { RefreshToken = "locked" }, CancellationToken.None);
        Assert.True(locked.IsFailure);
        Assert.Equal("USER_LOCKED", locked.Error!.Code);
    }

    [Fact]
    public async Task RefreshToken_ShouldReturnInternalFailure_WhenRepositoryThrows()
    {
        var fixture = new AuthFixture();
        fixture.Users.Setup(x => x.GetByRefreshTokenAsync("boom", It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("database unavailable"));

        var result = await fixture.CreateRefreshTokenHandler().Handle(
            new RefreshTokenCommand { RefreshToken = "boom" },
            CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("REFRESH_ERROR", result.Error!.Code);
    }

    [Fact]
    public async Task ValidateToken_ShouldReturnInvalidForBadTokenMissingUserAndLockedUser()
    {
        var fixture = new AuthFixture();
        var userId = Guid.NewGuid();
        var handler = fixture.CreateValidateTokenHandler();

        fixture.TokenService.Setup(x => x.ValidateAccessToken("bad")).Returns((Guid?)null);
        var invalid = await handler.Handle(new ValidateTokenQuery { Token = "bad" }, CancellationToken.None);
        Assert.True(invalid.IsSuccess);
        Assert.False(invalid.Value!.IsValid);
        Assert.Equal("Token is invalid or expired", invalid.Value.Message);

        fixture.TokenService.Setup(x => x.ValidateAccessToken("missing-user")).Returns(userId);
        fixture.Users.Setup(x => x.GetByIdAsync(userId, It.IsAny<CancellationToken>())).ReturnsAsync((User?)null);
        var missingUser = await handler.Handle(new ValidateTokenQuery { Token = "missing-user" }, CancellationToken.None);
        Assert.False(missingUser.Value!.IsValid);
        Assert.Equal(userId, missingUser.Value.UserId);

        var lockedUser = CreateUser();
        lockedUser.LockAccount();
        fixture.TokenService.Setup(x => x.ValidateAccessToken("locked")).Returns(lockedUser.Id);
        fixture.Users.Setup(x => x.GetByIdAsync(lockedUser.Id, It.IsAny<CancellationToken>())).ReturnsAsync(lockedUser);
        var locked = await handler.Handle(new ValidateTokenQuery { Token = "locked" }, CancellationToken.None);
        Assert.False(locked.Value!.IsValid);
        Assert.Equal("User account is locked", locked.Value.Message);
    }

    [Fact]
    public async Task ValidateToken_ShouldReturnValidDto_AndMapExceptionsToFailure()
    {
        var fixture = new AuthFixture();
        var user = CreateUser();
        fixture.TokenService.Setup(x => x.ValidateAccessToken("valid")).Returns(user.Id);
        fixture.TokenService.Setup(x => x.GetAccessTokenLifetime()).Returns(TimeSpan.FromMinutes(15));
        fixture.Users.Setup(x => x.GetByIdAsync(user.Id, It.IsAny<CancellationToken>())).ReturnsAsync(user);

        var handler = fixture.CreateValidateTokenHandler();
        var valid = await handler.Handle(new ValidateTokenQuery { Token = "valid" }, CancellationToken.None);

        Assert.True(valid.IsSuccess);
        Assert.True(valid.Value!.IsValid);
        Assert.Equal(user.Id, valid.Value.UserId);
        Assert.Equal(user.Email.Value, valid.Value.Email);
        Assert.True(valid.Value.ExpiresAt > DateTime.UtcNow);

        fixture.TokenService.Setup(x => x.ValidateAccessToken("throws")).Throws(new InvalidOperationException("jwt failure"));
        var failed = await handler.Handle(new ValidateTokenQuery { Token = "throws" }, CancellationToken.None);

        Assert.True(failed.IsFailure);
        Assert.Equal("TOKEN_VALIDATION_ERROR", failed.Error!.Code);
    }

    private static User CreateUser(string email = "user@example.com")
        => User.Create(Email.Create(email), "password-hash", "First", "Last");

    private static void AddRefreshTokenToUser(User user, RefreshTokenEntity token)
    {
        var field = typeof(User).GetField("_refreshTokens", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic);
        var tokens = Assert.IsType<List<RefreshTokenEntity>>(field!.GetValue(user));
        tokens.Add(token);
    }

    private sealed class AuthFixture
    {
        public Mock<IAuthUnitOfWork> UnitOfWork { get; } = new();
        public Mock<IUserRepository> Users { get; } = new();
        public Mock<IRefreshTokenRepository> RefreshTokens { get; } = new();
        public Mock<ILoginHistoryRepository> LoginHistory { get; } = new();
        public Mock<IPasswordHistoryRepository> PasswordHistory { get; } = new();
        public Mock<IPasswordHasher> PasswordHasher { get; } = new();
        public Mock<ITokenService> TokenService { get; } = new();
        public Mock<ITwoFactorService> TwoFactorService { get; } = new();
        public Mock<ICurrentUserService> CurrentUser { get; } = new();
        public Mock<IEmailService> EmailService { get; } = new();
        public Mock<IBusinessEventLogger> BusinessLogger { get; } = new();

        public AuthFixture()
        {
            UnitOfWork.SetupGet(x => x.Users).Returns(Users.Object);
            UnitOfWork.SetupGet(x => x.RefreshTokens).Returns(RefreshTokens.Object);
            UnitOfWork.SetupGet(x => x.LoginHistory).Returns(LoginHistory.Object);
            UnitOfWork.SetupGet(x => x.PasswordHistory).Returns(PasswordHistory.Object);
            UnitOfWork.Setup(x => x.SaveChangesAsync(It.IsAny<CancellationToken>())).ReturnsAsync(1);
            CurrentUser.SetupGet(x => x.IpAddress).Returns("127.0.0.1");
            CurrentUser.SetupGet(x => x.UserAgent).Returns("Mozilla/5.0 Chrome/120.0");
            EmailService
                .Setup(x => x.SendEmailVerificationAsync(
                    It.IsAny<string>(),
                    It.IsAny<string>(),
                    It.IsAny<string>(),
                    It.IsAny<CancellationToken>()))
                .Returns(Task.CompletedTask);
        }

        public RegisterCommandHandler CreateRegisterHandler()
            => new(
                UnitOfWork.Object,
                PasswordHasher.Object,
                TokenService.Object,
                CurrentUser.Object,
                EmailService.Object,
                Options.Create(new FrontendOptions { BaseUrl = "https://app.example.com/" }),
                BusinessLogger.Object,
                Mock.Of<ILogger<RegisterCommandHandler>>());

        public LoginCommandHandler CreateLoginHandler()
            => new(
                UnitOfWork.Object,
                PasswordHasher.Object,
                TokenService.Object,
                TwoFactorService.Object,
                CurrentUser.Object,
                BusinessLogger.Object,
                Mock.Of<ILogger<LoginCommandHandler>>());

        public RefreshTokenCommandHandler CreateRefreshTokenHandler()
            => new(
                UnitOfWork.Object,
                TokenService.Object,
                CurrentUser.Object,
                Mock.Of<ILogger<RefreshTokenCommandHandler>>());

        public ValidateTokenQueryHandler CreateValidateTokenHandler()
            => new(
                TokenService.Object,
                Users.Object,
                Mock.Of<ILogger<ValidateTokenQueryHandler>>());
    }
}
