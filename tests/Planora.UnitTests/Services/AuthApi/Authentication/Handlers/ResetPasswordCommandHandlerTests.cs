using Planora.Auth.Application.Common.Interfaces;
using Planora.Auth.Application.Common.Security;
using Planora.Auth.Application.Features.Authentication.Commands.ResetPassword;
using Planora.Auth.Application.Features.Authentication.Handlers.ResetPassword;
using Planora.Auth.Application.Features.Authentication.Validators.ResetPassword;
using Planora.Auth.Domain.Entities;
using Planora.Auth.Domain.Repositories;
using Planora.Auth.Domain.ValueObjects;
using Microsoft.Extensions.Logging;
using Moq;

namespace Planora.UnitTests.Services.AuthApi.Authentication.Handlers;

public class ResetPasswordCommandHandlerTests
{
    [Fact]
    public async Task Handle_ShouldConsumeResetToken_ChangePassword_AndRevokeSessions()
    {
        const string resetToken = "reset-token";
        const string newPassword = "NewPassword123!";
        const string newPasswordHash = "new-password-hash";

        var user = User.Create(
            Email.Create("user@example.com"),
            "old-password-hash",
            "First",
            "Last");
        var refreshToken = user.AddRefreshToken(
            "refresh-token",
            "127.0.0.1",
            DateTime.UtcNow.AddDays(7));
        user.SetPasswordResetToken(
            OpaqueToken.Hash(resetToken),
            DateTime.UtcNow.AddHours(1));

        var unitOfWorkMock = new Mock<IAuthUnitOfWork>();
        var userRepoMock = new Mock<IUserRepository>();
        var passwordHasherMock = new Mock<IPasswordHasher>();
        var passwordValidatorMock = new Mock<IPasswordValidator>();
        var tokenServiceMock = new Mock<IPasswordResetTokenService>();
        var emailServiceMock = new Mock<IEmailService>();
        var loggerMock = new Mock<ILogger<ResetPasswordCommandHandler>>();
        tokenServiceMock.Setup(x => x.HashToken(resetToken))
            .Returns(OpaqueToken.Hash(resetToken));
        tokenServiceMock.Setup(x => x.IsTokenValid(
                resetToken,
                user.PasswordResetToken,
                user.PasswordResetTokenExpiry))
            .Returns(true);

        unitOfWorkMock.SetupGet(x => x.Users).Returns(userRepoMock.Object);
        unitOfWorkMock.Setup(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(1);

        userRepoMock.Setup(x => x.GetByPasswordResetTokenAsync(
                OpaqueToken.Hash(resetToken),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(user);

        passwordValidatorMock.Setup(x => x.IsStrongPassword(newPassword))
            .Returns(true);
        passwordValidatorMock.Setup(x => x.IsPasswordCompromisedAsync(
                newPassword,
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(false);
        passwordHasherMock.Setup(x => x.HashPassword(newPassword))
            .Returns(newPasswordHash);
        emailServiceMock.Setup(x => x.SendPasswordChangedNotificationAsync(
                user.Email.Value,
                user.FirstName,
                It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);

        var handler = new ResetPasswordCommandHandler(
            unitOfWorkMock.Object,
            passwordHasherMock.Object,
            passwordValidatorMock.Object,
            tokenServiceMock.Object,
            emailServiceMock.Object,
            loggerMock.Object);

        var result = await handler.Handle(
            new ResetPasswordCommand
            {
                ResetToken = resetToken,
                NewPassword = newPassword
            },
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(newPasswordHash, user.PasswordHash);
        Assert.Null(user.PasswordResetToken);
        Assert.Null(user.PasswordResetTokenExpiry);
        Assert.False(refreshToken.IsActive);

        userRepoMock.Verify(x => x.Update(user), Times.Once);
        unitOfWorkMock.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Handle_ShouldRejectConsumedResetToken_WhenUsedAgain()
    {
        const string resetToken = "one-time-reset-token";
        const string newPassword = "NewPassword123!";
        var tokenHash = OpaqueToken.Hash(resetToken);

        var user = User.Create(
            Email.Create("user@example.com"),
            "old-password-hash",
            "First",
            "Last");
        user.SetPasswordResetToken(tokenHash, DateTime.UtcNow.AddHours(1));

        var unitOfWorkMock = new Mock<IAuthUnitOfWork>();
        var userRepoMock = new Mock<IUserRepository>();
        var passwordHasherMock = new Mock<IPasswordHasher>();
        var passwordValidatorMock = new Mock<IPasswordValidator>();
        var tokenServiceMock = new Mock<IPasswordResetTokenService>();
        var emailServiceMock = new Mock<IEmailService>();
        var loggerMock = new Mock<ILogger<ResetPasswordCommandHandler>>();
        tokenServiceMock.Setup(x => x.HashToken(resetToken))
            .Returns(tokenHash);
        tokenServiceMock.Setup(x => x.IsTokenValid(
                resetToken,
                user.PasswordResetToken,
                user.PasswordResetTokenExpiry))
            .Returns(() => user.PasswordResetToken == tokenHash);

        unitOfWorkMock.SetupGet(x => x.Users).Returns(userRepoMock.Object);
        unitOfWorkMock.Setup(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(1);
        userRepoMock.Setup(x => x.GetByPasswordResetTokenAsync(
                tokenHash,
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(() => user.PasswordResetToken == tokenHash ? user : null);
        passwordValidatorMock.Setup(x => x.IsStrongPassword(newPassword))
            .Returns(true);
        passwordValidatorMock.Setup(x => x.IsPasswordCompromisedAsync(
                newPassword,
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(false);
        passwordHasherMock.Setup(x => x.HashPassword(newPassword))
            .Returns("new-password-hash");
        emailServiceMock.Setup(x => x.SendPasswordChangedNotificationAsync(
                user.Email.Value,
                user.FirstName,
                It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);

        var handler = new ResetPasswordCommandHandler(
            unitOfWorkMock.Object,
            passwordHasherMock.Object,
            passwordValidatorMock.Object,
            tokenServiceMock.Object,
            emailServiceMock.Object,
            loggerMock.Object);

        var command = new ResetPasswordCommand
        {
            ResetToken = resetToken,
            NewPassword = newPassword
        };

        var firstResult = await handler.Handle(command, CancellationToken.None);
        var secondResult = await handler.Handle(command, CancellationToken.None);

        Assert.True(firstResult.IsSuccess);
        Assert.True(secondResult.IsFailure);
        Assert.Equal("INVALID_TOKEN", secondResult.Error!.Code);
        Assert.Null(user.PasswordResetToken);
        Assert.Null(user.PasswordResetTokenExpiry);

        unitOfWorkMock.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Once);
        emailServiceMock.Verify(x => x.SendPasswordChangedNotificationAsync(
                user.Email.Value,
                user.FirstName,
                It.IsAny<CancellationToken>()),
            Times.Once);
    }

    [Fact]
    [Trait("TestType", "Security")]
    [Trait("TestType", "Regression")]
    public async Task Handle_ShouldRejectMissingResetTokenWithoutMutatingUser()
    {
        const string resetToken = "missing-token";
        var fixture = CreateFixture();
        fixture.TokenService.Setup(x => x.HashToken(resetToken)).Returns("missing-token-hash");
        fixture.Users.Setup(x => x.GetByPasswordResetTokenAsync("missing-token-hash", It.IsAny<CancellationToken>()))
            .ReturnsAsync((User?)null);

        var result = await fixture.Handler.Handle(
            new ResetPasswordCommand { ResetToken = resetToken, NewPassword = "NewPassword123!" },
            CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("INVALID_TOKEN", result.Error!.Code);
        fixture.PasswordValidator.Verify(x => x.IsStrongPassword(It.IsAny<string>()), Times.Never);
        fixture.PasswordHasher.Verify(x => x.HashPassword(It.IsAny<string>()), Times.Never);
        fixture.UnitOfWork.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Never);
        fixture.EmailService.Verify(x => x.SendPasswordChangedNotificationAsync(
            It.IsAny<string>(),
            It.IsAny<string>(),
            It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    [Trait("TestType", "Security")]
    [Trait("TestType", "Regression")]
    public async Task Handle_ShouldClearExpiredResetTokenAndRejectRequest()
    {
        const string resetToken = "expired-token";
        const string tokenHash = "expired-token-hash";
        var user = User.Create(Email.Create("expired@example.com"), "old-hash", "Expired", "User");
        user.SetPasswordResetToken(tokenHash, DateTime.UtcNow.AddMinutes(10));
        var fixture = CreateFixture();
        fixture.TokenService.Setup(x => x.HashToken(resetToken)).Returns(tokenHash);
        fixture.TokenService.Setup(x => x.IsTokenValid(resetToken, tokenHash, user.PasswordResetTokenExpiry)).Returns(false);
        fixture.Users.Setup(x => x.GetByPasswordResetTokenAsync(tokenHash, It.IsAny<CancellationToken>())).ReturnsAsync(user);
        fixture.UnitOfWork.Setup(x => x.SaveChangesAsync(It.IsAny<CancellationToken>())).ReturnsAsync(1);

        var result = await fixture.Handler.Handle(
            new ResetPasswordCommand { ResetToken = resetToken, NewPassword = "NewPassword123!" },
            CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("INVALID_TOKEN", result.Error!.Code);
        Assert.Null(user.PasswordResetToken);
        Assert.Null(user.PasswordResetTokenExpiry);
        fixture.Users.Verify(x => x.Update(user), Times.Once);
        fixture.UnitOfWork.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Once);
        fixture.PasswordValidator.Verify(x => x.IsStrongPassword(It.IsAny<string>()), Times.Never);
    }

    [Fact]
    [Trait("TestType", "Security")]
    [Trait("TestType", "Regression")]
    public async Task Handle_ShouldRejectWeakPasswordBeforeCompromiseCheck()
    {
        const string resetToken = "valid-token";
        const string tokenHash = "valid-token-hash";
        var user = User.Create(Email.Create("weak@example.com"), "old-hash", "Weak", "User");
        user.SetPasswordResetToken(tokenHash, DateTime.UtcNow.AddMinutes(10));
        var fixture = CreateFixture();
        fixture.TokenService.Setup(x => x.HashToken(resetToken)).Returns(tokenHash);
        fixture.TokenService.Setup(x => x.IsTokenValid(resetToken, tokenHash, user.PasswordResetTokenExpiry)).Returns(true);
        fixture.Users.Setup(x => x.GetByPasswordResetTokenAsync(tokenHash, It.IsAny<CancellationToken>())).ReturnsAsync(user);
        fixture.PasswordValidator.Setup(x => x.IsStrongPassword("weak")).Returns(false);

        var result = await fixture.Handler.Handle(
            new ResetPasswordCommand { ResetToken = resetToken, NewPassword = "weak" },
            CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("WEAK_PASSWORD", result.Error!.Code);
        fixture.PasswordValidator.Verify(x => x.IsPasswordCompromisedAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
        fixture.PasswordHasher.Verify(x => x.HashPassword(It.IsAny<string>()), Times.Never);
        fixture.UnitOfWork.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    [Trait("TestType", "Security")]
    [Trait("TestType", "Regression")]
    public async Task Handle_ShouldRejectCompromisedPasswordBeforeHashing()
    {
        const string resetToken = "valid-token";
        const string tokenHash = "valid-token-hash";
        const string compromisedPassword = "Compromised123!";
        var user = User.Create(Email.Create("compromised@example.com"), "old-hash", "Compromised", "User");
        user.SetPasswordResetToken(tokenHash, DateTime.UtcNow.AddMinutes(10));
        var fixture = CreateFixture();
        fixture.TokenService.Setup(x => x.HashToken(resetToken)).Returns(tokenHash);
        fixture.TokenService.Setup(x => x.IsTokenValid(resetToken, tokenHash, user.PasswordResetTokenExpiry)).Returns(true);
        fixture.Users.Setup(x => x.GetByPasswordResetTokenAsync(tokenHash, It.IsAny<CancellationToken>())).ReturnsAsync(user);
        fixture.PasswordValidator.Setup(x => x.IsStrongPassword(compromisedPassword)).Returns(true);
        fixture.PasswordValidator.Setup(x => x.IsPasswordCompromisedAsync(compromisedPassword, It.IsAny<CancellationToken>())).ReturnsAsync(true);

        var result = await fixture.Handler.Handle(
            new ResetPasswordCommand { ResetToken = resetToken, NewPassword = compromisedPassword },
            CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("COMPROMISED_PASSWORD", result.Error!.Code);
        fixture.PasswordHasher.Verify(x => x.HashPassword(It.IsAny<string>()), Times.Never);
        fixture.Users.Verify(x => x.Update(It.IsAny<User>()), Times.Never);
        fixture.EmailService.Verify(x => x.SendPasswordChangedNotificationAsync(
            It.IsAny<string>(),
            It.IsAny<string>(),
            It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    [Trait("TestType", "Resilience")]
    [Trait("TestType", "Regression")]
    public async Task Handle_ShouldReturnInternalFailureWhenDependencyThrows()
    {
        var fixture = CreateFixture();
        fixture.TokenService.Setup(x => x.HashToken("boom")).Throws(new InvalidOperationException("hashing failed"));

        var result = await fixture.Handler.Handle(
            new ResetPasswordCommand { ResetToken = "boom", NewPassword = "NewPassword123!" },
            CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("RESET_PASSWORD_ERROR", result.Error!.Code);
    }

    [Fact]
    public void Validator_ShouldRequireResetToken()
    {
        var validator = new ResetPasswordCommandValidator();

        var result = validator.Validate(new ResetPasswordCommand
        {
            ResetToken = "",
            NewPassword = "NewPassword123!"
        });

        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, error => error.PropertyName == nameof(ResetPasswordCommand.ResetToken));
    }

    private static Fixture CreateFixture()
    {
        var unitOfWork = new Mock<IAuthUnitOfWork>();
        var users = new Mock<IUserRepository>();
        var passwordHasher = new Mock<IPasswordHasher>();
        var passwordValidator = new Mock<IPasswordValidator>();
        var tokenService = new Mock<IPasswordResetTokenService>();
        var emailService = new Mock<IEmailService>();
        unitOfWork.SetupGet(x => x.Users).Returns(users.Object);

        return new Fixture(
            unitOfWork,
            users,
            passwordHasher,
            passwordValidator,
            tokenService,
            emailService,
            new ResetPasswordCommandHandler(
                unitOfWork.Object,
                passwordHasher.Object,
                passwordValidator.Object,
                tokenService.Object,
                emailService.Object,
                Mock.Of<ILogger<ResetPasswordCommandHandler>>()));
    }

    private sealed record Fixture(
        Mock<IAuthUnitOfWork> UnitOfWork,
        Mock<IUserRepository> Users,
        Mock<IPasswordHasher> PasswordHasher,
        Mock<IPasswordValidator> PasswordValidator,
        Mock<IPasswordResetTokenService> TokenService,
        Mock<IEmailService> EmailService,
        ResetPasswordCommandHandler Handler);
}
