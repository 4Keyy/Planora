using AutoMapper;
using Planora.Auth.Application.Common.DTOs;
using Planora.Auth.Application.Common.Interfaces;
using Planora.Auth.Application.Common.Options;
using Planora.Auth.Application.Common.Security;
using Planora.Auth.Application.Features.Users.Commands.ChangeEmail;
using Planora.Auth.Application.Features.Users.Commands.ChangePassword;
using Planora.Auth.Application.Features.Users.Commands.Disable2FA;
using Planora.Auth.Application.Features.Users.Commands.RevokeAllSessions;
using Planora.Auth.Application.Features.Users.Handlers.ChangeEmail;
using Planora.Auth.Application.Features.Users.Handlers.ChangePassword;
using Planora.Auth.Application.Features.Users.Handlers.Disable2FA;
using Planora.Auth.Application.Features.Users.Handlers.GetUserSecurity;
using Planora.Auth.Application.Features.Users.Handlers.RevokeSessions;
using Planora.Auth.Application.Features.Users.Queries.GetUserSecurity;
using Planora.Auth.Domain.Entities;
using Planora.Auth.Domain.Repositories;
using Planora.Auth.Domain.ValueObjects;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Moq;
using RefreshTokenEntity = Planora.Auth.Domain.Entities.RefreshToken;

namespace Planora.UnitTests.Services.AuthApi.Users.Handlers;

public class UserSecurityHandlerTests
{
    [Fact]
    public async Task ChangePassword_ShouldReturnSecurityFailuresBeforeMutatingUser()
    {
        var fixture = new AuthUserFixture(null);
        var notAuthenticated = await fixture.CreateChangePasswordHandler().Handle(
            new ChangePasswordCommand { CurrentPassword = "old", NewPassword = "new" },
            CancellationToken.None);
        Assert.True(notAuthenticated.IsFailure);
        Assert.Equal("NOT_AUTHENTICATED", notAuthenticated.Error!.Code);

        var userId = Guid.NewGuid();
        fixture = new AuthUserFixture(userId);
        fixture.Users.Setup(x => x.GetByIdAsync(userId, It.IsAny<CancellationToken>())).ReturnsAsync((User?)null);
        var notFound = await fixture.CreateChangePasswordHandler().Handle(
            new ChangePasswordCommand { CurrentPassword = "old", NewPassword = "new" },
            CancellationToken.None);
        Assert.Equal("USER_NOT_FOUND", notFound.Error!.Code);

        var user = CreateUser();
        fixture.Users.Setup(x => x.GetByIdAsync(userId, It.IsAny<CancellationToken>())).ReturnsAsync(user);
        fixture.PasswordHasher.Setup(x => x.VerifyPassword("wrong", user.PasswordHash)).Returns(false);
        var invalidPassword = await fixture.CreateChangePasswordHandler().Handle(
            new ChangePasswordCommand { CurrentPassword = "wrong", NewPassword = "StrongPassword927!" },
            CancellationToken.None);
        Assert.Equal("INVALID_PASSWORD", invalidPassword.Error!.Code);

        fixture.PasswordHasher.Setup(x => x.VerifyPassword("old", user.PasswordHash)).Returns(true);
        fixture.PasswordValidator.Setup(x => x.IsStrongPassword("weak")).Returns(false);
        var weak = await fixture.CreateChangePasswordHandler().Handle(
            new ChangePasswordCommand { CurrentPassword = "old", NewPassword = "weak" },
            CancellationToken.None);
        Assert.Equal("WEAK_PASSWORD", weak.Error!.Code);

        fixture.PasswordValidator.Setup(x => x.IsStrongPassword("CompromisedPassword927!")).Returns(true);
        fixture.PasswordValidator
            .Setup(x => x.IsPasswordCompromisedAsync("CompromisedPassword927!", It.IsAny<CancellationToken>()))
            .ReturnsAsync(true);
        var compromised = await fixture.CreateChangePasswordHandler().Handle(
            new ChangePasswordCommand { CurrentPassword = "old", NewPassword = "CompromisedPassword927!" },
            CancellationToken.None);
        Assert.Equal("COMPROMISED_PASSWORD", compromised.Error!.Code);

        fixture.PasswordValidator
            .Setup(x => x.IsPasswordCompromisedAsync("ReusedPassword927!", It.IsAny<CancellationToken>()))
            .ReturnsAsync(false);
        fixture.PasswordValidator.Setup(x => x.IsStrongPassword("ReusedPassword927!")).Returns(true);
        fixture.PasswordValidator
            .Setup(x => x.IsDifferentFromPreviousPasswordsAsync(user.Id, "ReusedPassword927!", 5, It.IsAny<CancellationToken>()))
            .ReturnsAsync(false);
        var reused = await fixture.CreateChangePasswordHandler().Handle(
            new ChangePasswordCommand { CurrentPassword = "old", NewPassword = "ReusedPassword927!" },
            CancellationToken.None);
        Assert.Equal("PASSWORD_REUSED", reused.Error!.Code);

        fixture.Users.Verify(x => x.Update(It.IsAny<User>()), Times.Never);
        fixture.UnitOfWork.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task ChangePassword_ShouldPersistHistoryRevokeSessionsAndSendNotification()
    {
        var userId = Guid.NewGuid();
        var fixture = new AuthUserFixture(userId);
        var user = CreateUser();
        PasswordHistory? passwordHistory = null;
        fixture.Users.Setup(x => x.GetByIdAsync(userId, It.IsAny<CancellationToken>())).ReturnsAsync(user);
        fixture.PasswordHasher.Setup(x => x.VerifyPassword("old-password", user.PasswordHash)).Returns(true);
        fixture.PasswordHasher.Setup(x => x.HashPassword("NewPassword927!")).Returns("new-hash");
        fixture.PasswordValidator.Setup(x => x.IsStrongPassword("NewPassword927!")).Returns(true);
        fixture.PasswordValidator
            .Setup(x => x.IsPasswordCompromisedAsync("NewPassword927!", It.IsAny<CancellationToken>()))
            .ReturnsAsync(false);
        fixture.PasswordValidator
            .Setup(x => x.IsDifferentFromPreviousPasswordsAsync(user.Id, "NewPassword927!", 5, It.IsAny<CancellationToken>()))
            .ReturnsAsync(true);
        fixture.PasswordHistory
            .Setup(x => x.AddAsync(It.IsAny<PasswordHistory>(), It.IsAny<CancellationToken>()))
            .Callback<PasswordHistory, CancellationToken>((history, _) => passwordHistory = history)
            .ReturnsAsync((PasswordHistory history, CancellationToken _) => history);

        var result = await fixture.CreateChangePasswordHandler().Handle(
            new ChangePasswordCommand
            {
                CurrentPassword = "old-password",
                NewPassword = "NewPassword927!",
                ConfirmNewPassword = "NewPassword927!"
            },
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal("new-hash", user.PasswordHash);
        Assert.NotNull(passwordHistory);
        Assert.Equal("old-hash", passwordHistory!.PasswordHash);
        fixture.Users.Verify(x => x.Update(user), Times.Once);
        fixture.UnitOfWork.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Once);
        fixture.PasswordHistory.Verify(x => x.DeleteOldHistoryAsync(user.Id, 5, It.IsAny<CancellationToken>()), Times.Once);
        fixture.EmailService.Verify(
            x => x.SendPasswordChangedNotificationAsync(user.Email.Value, user.FirstName, It.IsAny<CancellationToken>()),
            Times.Once);
    }

    [Fact]
    public async Task ChangeEmail_ShouldValidateAuthenticationPasswordEmailAndUniqueness()
    {
        var unauthenticated = new AuthUserFixture(null);
        var authResult = await unauthenticated.CreateChangeEmailHandler().Handle(
            new ChangeEmailCommand { NewEmail = "new@example.com", Password = "password" },
            CancellationToken.None);
        Assert.Equal("NOT_AUTHENTICATED", authResult.Error!.Code);
        unauthenticated.Users.Verify(x => x.GetByIdAsync(It.IsAny<Guid>(), It.IsAny<CancellationToken>()), Times.Never);

        var userId = Guid.NewGuid();
        var fixture = new AuthUserFixture(userId);
        fixture.Users.Setup(x => x.GetByIdAsync(userId, It.IsAny<CancellationToken>())).ReturnsAsync((User?)null);
        var missing = await fixture.CreateChangeEmailHandler().Handle(
            new ChangeEmailCommand { NewEmail = "new@example.com", Password = "password" },
            CancellationToken.None);
        Assert.Equal("USER_NOT_FOUND", missing.Error!.Code);

        var user = CreateUser();
        fixture.Users.Setup(x => x.GetByIdAsync(userId, It.IsAny<CancellationToken>())).ReturnsAsync(user);

        fixture.PasswordHasher.Setup(x => x.VerifyPassword("wrong", user.PasswordHash)).Returns(false);
        var invalidPassword = await fixture.CreateChangeEmailHandler().Handle(
            new ChangeEmailCommand { NewEmail = "new@example.com", Password = "wrong" },
            CancellationToken.None);
        Assert.Equal("INVALID_PASSWORD", invalidPassword.Error!.Code);

        fixture.PasswordHasher.Setup(x => x.VerifyPassword("password", user.PasswordHash)).Returns(true);
        var invalidEmail = await fixture.CreateChangeEmailHandler().Handle(
            new ChangeEmailCommand { NewEmail = "not-email", Password = "password" },
            CancellationToken.None);
        Assert.Equal("INVALID_EMAIL", invalidEmail.Error!.Code);

        fixture.Users
            .Setup(x => x.GetByEmailAsync(It.IsAny<Email>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(CreateUser("existing@example.com"));
        var duplicate = await fixture.CreateChangeEmailHandler().Handle(
            new ChangeEmailCommand { NewEmail = "existing@example.com", Password = "password" },
            CancellationToken.None);
        Assert.Equal("EMAIL_EXISTS", duplicate.Error!.Code);

        fixture.Users.Verify(x => x.Update(It.IsAny<User>()), Times.Never);
    }

    [Fact]
    public async Task ChangeEmail_ShouldStoreOneTimeVerificationTokenAndSendConfiguredLink()
    {
        var userId = Guid.NewGuid();
        var fixture = new AuthUserFixture(userId);
        var user = CreateUser();
        string? verificationLink = null;
        fixture.Users.Setup(x => x.GetByIdAsync(userId, It.IsAny<CancellationToken>())).ReturnsAsync(user);
        fixture.Users.Setup(x => x.GetByEmailAsync(It.IsAny<Email>(), It.IsAny<CancellationToken>())).ReturnsAsync((User?)null);
        fixture.PasswordHasher.Setup(x => x.VerifyPassword("password", user.PasswordHash)).Returns(true);
        fixture.EmailService
            .Setup(x => x.SendEmailVerificationAsync("new@example.com", user.FirstName, It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .Callback<string, string, string, CancellationToken>((_, _, link, _) => verificationLink = link)
            .Returns(Task.CompletedTask);

        var result = await fixture.CreateChangeEmailHandler().Handle(
            new ChangeEmailCommand { NewEmail = "new@example.com", Password = "password" },
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal("new@example.com", user.Email.Value);
        Assert.False(user.IsEmailVerified);
        Assert.NotNull(user.EmailVerificationToken);
        Assert.NotNull(verificationLink);
        Assert.StartsWith("https://app.example.com/auth/verify-email?token=", verificationLink);
        var rawToken = new Uri(verificationLink!).Query.TrimStart('?').Split('=')[1];
        Assert.Equal(OpaqueToken.Hash(rawToken), user.EmailVerificationToken);
        fixture.Users.Verify(x => x.Update(user), Times.Once);
        fixture.UnitOfWork.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Disable2FA_ShouldValidatePasswordAndPersistSuccessfulDisable()
    {
        var userId = Guid.NewGuid();
        var fixture = new AuthUserFixture(userId);
        var user = CreateUser();
        user.EnableTwoFactor("secret");
        fixture.Users.Setup(x => x.GetByIdAsync(userId, It.IsAny<CancellationToken>())).ReturnsAsync(user);

        fixture.PasswordHasher.Setup(x => x.VerifyPassword("wrong", user.PasswordHash)).Returns(false);
        var invalid = await fixture.CreateDisable2FAHandler().Handle(
            new Disable2FACommand { Password = "wrong" },
            CancellationToken.None);
        Assert.Equal("INVALID_PASSWORD", invalid.Error!.Code);

        fixture.PasswordHasher.Setup(x => x.VerifyPassword("password", user.PasswordHash)).Returns(true);
        var success = await fixture.CreateDisable2FAHandler().Handle(
            new Disable2FACommand { Password = "password" },
            CancellationToken.None);

        Assert.True(success.IsSuccess);
        Assert.False(user.TwoFactorEnabled);
        fixture.Users.Verify(x => x.Update(user), Times.Once);
        fixture.UnitOfWork.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Once);

        var notEnabled = await fixture.CreateDisable2FAHandler().Handle(
            new Disable2FACommand { Password = "password" },
            CancellationToken.None);
        Assert.Equal("2FA_NOT_ENABLED", notEnabled.Error!.Code);
    }

    [Fact]
    [Trait("TestType", "Security")]
    [Trait("TestType", "Regression")]
    public async Task Disable2FA_ShouldReturnAuthAndNotFoundFailuresBeforePasswordCheck()
    {
        var unauthenticated = new AuthUserFixture(null);
        var authResult = await unauthenticated.CreateDisable2FAHandler().Handle(
            new Disable2FACommand { Password = "password" },
            CancellationToken.None);
        Assert.Equal("NOT_AUTHENTICATED", authResult.Error!.Code);
        unauthenticated.Users.Verify(x => x.GetByIdAsync(It.IsAny<Guid>(), It.IsAny<CancellationToken>()), Times.Never);

        var userId = Guid.NewGuid();
        var missing = new AuthUserFixture(userId);
        missing.Users.Setup(x => x.GetByIdAsync(userId, It.IsAny<CancellationToken>())).ReturnsAsync((User?)null);
        var missingResult = await missing.CreateDisable2FAHandler().Handle(
            new Disable2FACommand { Password = "password" },
            CancellationToken.None);
        Assert.Equal("USER_NOT_FOUND", missingResult.Error!.Code);
        missing.PasswordHasher.Verify(x => x.VerifyPassword(It.IsAny<string>(), It.IsAny<string>()), Times.Never);
    }

    [Fact]
    [Trait("TestType", "Resilience")]
    [Trait("TestType", "Regression")]
    public async Task Disable2FA_ShouldReturnInternalFailure_WhenPersistenceThrows()
    {
        var userId = Guid.NewGuid();
        var fixture = new AuthUserFixture(userId);
        var user = CreateUser();
        user.EnableTwoFactor("secret");
        fixture.Users.Setup(x => x.GetByIdAsync(userId, It.IsAny<CancellationToken>())).ReturnsAsync(user);
        fixture.PasswordHasher.Setup(x => x.VerifyPassword("password", user.PasswordHash)).Returns(true);
        fixture.UnitOfWork
            .Setup(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("save failed"));

        var result = await fixture.CreateDisable2FAHandler().Handle(
            new Disable2FACommand { Password = "password" },
            CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("DISABLE_2FA_ERROR", result.Error!.Code);
    }

    [Fact]
    public async Task RevokeAllSessions_ShouldRequirePasswordAndRevokeActiveRefreshTokens()
    {
        var userId = Guid.NewGuid();
        var fixture = new AuthUserFixture(userId);
        var user = CreateUser();
        var active = user.AddRefreshToken("refresh-token", "127.0.0.1", DateTime.UtcNow.AddDays(7));
        fixture.Users.Setup(x => x.GetByIdAsync(userId, It.IsAny<CancellationToken>())).ReturnsAsync(user);

        fixture.PasswordHasher.Setup(x => x.VerifyPassword("wrong", user.PasswordHash)).Returns(false);
        var invalid = await fixture.CreateRevokeAllSessionsHandler().Handle(
            new RevokeAllSessionsCommand { Password = "wrong" },
            CancellationToken.None);
        Assert.Equal("INVALID_PASSWORD", invalid.Error!.Code);

        fixture.PasswordHasher.Setup(x => x.VerifyPassword("password", user.PasswordHash)).Returns(true);
        var success = await fixture.CreateRevokeAllSessionsHandler().Handle(
            new RevokeAllSessionsCommand { Password = "password" },
            CancellationToken.None);

        Assert.True(success.IsSuccess);
        Assert.False(active.IsActive);
        Assert.Equal("10.0.0.5", active.RevokedByIp);
        fixture.Users.Verify(x => x.Update(user), Times.Once);
        fixture.UnitOfWork.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    [Trait("TestType", "Security")]
    [Trait("TestType", "Regression")]
    public async Task RevokeAllSessions_ShouldReturnAuthAndNotFoundFailuresBeforePasswordCheck()
    {
        var unauthenticated = new AuthUserFixture(null);
        var authResult = await unauthenticated.CreateRevokeAllSessionsHandler().Handle(
            new RevokeAllSessionsCommand { Password = "password" },
            CancellationToken.None);
        Assert.Equal("NOT_AUTHENTICATED", authResult.Error!.Code);
        unauthenticated.Users.Verify(x => x.GetByIdAsync(It.IsAny<Guid>(), It.IsAny<CancellationToken>()), Times.Never);

        var userId = Guid.NewGuid();
        var missing = new AuthUserFixture(userId);
        missing.Users.Setup(x => x.GetByIdAsync(userId, It.IsAny<CancellationToken>())).ReturnsAsync((User?)null);
        var missingResult = await missing.CreateRevokeAllSessionsHandler().Handle(
            new RevokeAllSessionsCommand { Password = "password" },
            CancellationToken.None);
        Assert.Equal("USER_NOT_FOUND", missingResult.Error!.Code);
        missing.PasswordHasher.Verify(x => x.VerifyPassword(It.IsAny<string>(), It.IsAny<string>()), Times.Never);
    }

    [Fact]
    [Trait("TestType", "Resilience")]
    [Trait("TestType", "Regression")]
    public async Task RevokeAllSessions_ShouldReturnInternalFailure_WhenPersistenceThrows()
    {
        var userId = Guid.NewGuid();
        var fixture = new AuthUserFixture(userId);
        var user = CreateUser();
        user.AddRefreshToken("refresh-token", "127.0.0.1", DateTime.UtcNow.AddDays(7));
        fixture.Users.Setup(x => x.GetByIdAsync(userId, It.IsAny<CancellationToken>())).ReturnsAsync(user);
        fixture.PasswordHasher.Setup(x => x.VerifyPassword("password", user.PasswordHash)).Returns(true);
        fixture.UnitOfWork
            .Setup(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("save failed"));

        var result = await fixture.CreateRevokeAllSessionsHandler().Handle(
            new RevokeAllSessionsCommand { Password = "password" },
            CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("REVOKE_ALL_ERROR", result.Error!.Code);
    }

    [Fact]
    public async Task GetUserSecurity_ShouldMapActiveSessionsAndRecentLogins()
    {
        var userId = Guid.NewGuid();
        var fixture = new AuthUserFixture(userId);
        var user = CreateUser();
        var token = new RefreshTokenEntity(user.Id, "token", "127.0.0.1", DateTime.UtcNow.AddDays(1));
        var login = new LoginHistory(user.Id, "127.0.0.1", "Chrome", true);
        fixture.UserRepository.Setup(x => x.GetByIdAsync(userId, It.IsAny<CancellationToken>())).ReturnsAsync(user);
        fixture.RefreshTokens.Setup(x => x.GetActiveTokensByUserIdAsync(user.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new[] { token });
        fixture.LoginHistory.Setup(x => x.GetByUserIdAsync(user.Id, 10, It.IsAny<CancellationToken>()))
            .ReturnsAsync((IReadOnlyList<LoginHistory>)new[] { login });
        fixture.Mapper.Setup(x => x.Map<List<RefreshTokenDetailDto>>(It.IsAny<IReadOnlyList<RefreshTokenEntity>>()))
            .Returns(new List<RefreshTokenDetailDto> { new() { Id = token.Id, Token = token.Token } });
        fixture.Mapper.Setup(x => x.Map<List<LoginHistoryDto>>(It.IsAny<IReadOnlyList<LoginHistory>>()))
            .Returns(new List<LoginHistoryDto> { new() { Id = login.Id, IpAddress = login.IpAddress } });

        var result = await fixture.CreateGetUserSecurityHandler().Handle(new GetUserSecurityQuery(), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(user.Id, result.Value!.UserId);
        Assert.Equal(1, result.Value.ActiveSessionsCount);
        Assert.Single(result.Value.ActiveTokens);
        Assert.Single(result.Value.RecentLogins);
    }

    [Fact]
    public async Task GetUserSecurity_ShouldReturnFailuresForMissingUserAndRepositoryException()
    {
        var unauthenticated = await new AuthUserFixture(null)
            .CreateGetUserSecurityHandler()
            .Handle(new GetUserSecurityQuery(), CancellationToken.None);
        Assert.Equal("NOT_AUTHENTICATED", unauthenticated.Error!.Code);

        var userId = Guid.NewGuid();
        var fixture = new AuthUserFixture(userId);
        fixture.UserRepository.Setup(x => x.GetByIdAsync(userId, It.IsAny<CancellationToken>())).ReturnsAsync((User?)null);
        var notFound = await fixture.CreateGetUserSecurityHandler().Handle(new GetUserSecurityQuery(), CancellationToken.None);
        Assert.Equal("USER_NOT_FOUND", notFound.Error!.Code);

        fixture.UserRepository.Setup(x => x.GetByIdAsync(userId, It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("db down"));
        var failed = await fixture.CreateGetUserSecurityHandler().Handle(new GetUserSecurityQuery(), CancellationToken.None);
        Assert.Equal("GET_SECURITY_ERROR", failed.Error!.Code);
    }

    private static User CreateUser(string email = "user@example.com")
        => User.Create(Email.Create(email), "old-hash", "Ada", "Lovelace");

    private sealed class AuthUserFixture
    {
        public Mock<IAuthUnitOfWork> UnitOfWork { get; } = new();
        public Mock<IUserRepository> Users { get; } = new();
        public Mock<IUserRepository> UserRepository { get; } = new();
        public Mock<IRefreshTokenRepository> RefreshTokens { get; } = new();
        public Mock<ILoginHistoryRepository> LoginHistory { get; } = new();
        public Mock<IPasswordHistoryRepository> PasswordHistory { get; } = new();
        public Mock<IPasswordHasher> PasswordHasher { get; } = new();
        public Mock<IPasswordValidator> PasswordValidator { get; } = new();
        public Mock<ICurrentUserService> CurrentUser { get; } = new();
        public Mock<IEmailService> EmailService { get; } = new();
        public Mock<IMapper> Mapper { get; } = new();

        public AuthUserFixture(Guid? userId)
        {
            UnitOfWork.SetupGet(x => x.Users).Returns(Users.Object);
            UnitOfWork.SetupGet(x => x.PasswordHistory).Returns(PasswordHistory.Object);
            UnitOfWork.Setup(x => x.SaveChangesAsync(It.IsAny<CancellationToken>())).ReturnsAsync(1);
            CurrentUser.SetupGet(x => x.UserId).Returns(userId);
            CurrentUser.SetupGet(x => x.IpAddress).Returns("10.0.0.5");
            EmailService
                .Setup(x => x.SendPasswordChangedNotificationAsync(
                    It.IsAny<string>(),
                    It.IsAny<string>(),
                    It.IsAny<CancellationToken>()))
                .Returns(Task.CompletedTask);
            EmailService
                .Setup(x => x.SendEmailVerificationAsync(
                    It.IsAny<string>(),
                    It.IsAny<string>(),
                    It.IsAny<string>(),
                    It.IsAny<CancellationToken>()))
                .Returns(Task.CompletedTask);
        }

        public ChangePasswordCommandHandler CreateChangePasswordHandler()
            => new(
                UnitOfWork.Object,
                PasswordHasher.Object,
                PasswordValidator.Object,
                CurrentUser.Object,
                EmailService.Object,
                Mock.Of<ILogger<ChangePasswordCommandHandler>>());

        public ChangeEmailCommandHandler CreateChangeEmailHandler()
            => new(
                UnitOfWork.Object,
                PasswordHasher.Object,
                CurrentUser.Object,
                EmailService.Object,
                Options.Create(new FrontendOptions { BaseUrl = "https://app.example.com" }),
                Mock.Of<ILogger<ChangeEmailCommandHandler>>());

        public Disable2FACommandHandler CreateDisable2FAHandler()
            => new(
                UnitOfWork.Object,
                PasswordHasher.Object,
                CurrentUser.Object,
                Mock.Of<ILogger<Disable2FACommandHandler>>());

        public RevokeAllSessionsCommandHandler CreateRevokeAllSessionsHandler()
            => new(
                UnitOfWork.Object,
                PasswordHasher.Object,
                CurrentUser.Object,
                Mock.Of<ILogger<RevokeAllSessionsCommandHandler>>());

        public GetUserSecurityQueryHandler CreateGetUserSecurityHandler()
            => new(
                UserRepository.Object,
                RefreshTokens.Object,
                LoginHistory.Object,
                CurrentUser.Object,
                Mapper.Object,
                Mock.Of<ILogger<GetUserSecurityQueryHandler>>());
    }
}
