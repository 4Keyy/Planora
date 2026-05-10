using Planora.Auth.Application.Common.Security;
using Planora.Auth.Application.Common.Options;
using Planora.Auth.Application.Common.Interfaces;
using Planora.Auth.Application.Features.Users.Commands.ResendEmailVerification;
using Planora.Auth.Application.Features.Users.Commands.VerifyEmail;
using Planora.Auth.Application.Features.Users.Handlers.ResendEmailVerification;
using Planora.Auth.Application.Features.Users.Handlers.VerifyEmail;
using Planora.Auth.Application.Features.Users.Validators.VerifyEmail;
using Planora.Auth.Domain.Entities;
using Planora.Auth.Domain.Repositories;
using Planora.Auth.Domain.ValueObjects;
using Microsoft.Extensions.Options;
using Microsoft.Extensions.Logging;
using Moq;

namespace Planora.UnitTests.Services.AuthApi.Users.Handlers;

public class VerifyEmailCommandHandlerTests
{
    [Fact]
    public async Task Handle_ShouldVerifyEmail_WhenTokenHashAndExpiryAreValid()
    {
        const string verificationToken = "verification-token";
        var tokenHash = OpaqueToken.Hash(verificationToken);
        var user = User.Create(
            Email.Create("user@example.com"),
            "password-hash",
            "First",
            "Last");
        user.SetEmailVerificationToken(tokenHash, DateTime.UtcNow.AddHours(1));

        var unitOfWorkMock = new Mock<IAuthUnitOfWork>();
        var userRepoMock = new Mock<IUserRepository>();
        var loggerMock = new Mock<ILogger<VerifyEmailCommandHandler>>();

        unitOfWorkMock.SetupGet(x => x.Users).Returns(userRepoMock.Object);
        unitOfWorkMock.Setup(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(1);

        userRepoMock.Setup(x => x.GetByEmailVerificationTokenAsync(
                tokenHash,
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(user);

        var handler = new VerifyEmailCommandHandler(
            unitOfWorkMock.Object,
            loggerMock.Object);

        var result = await handler.Handle(
            new VerifyEmailCommand { Token = verificationToken },
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.True(user.IsEmailVerified);
        Assert.NotNull(user.EmailVerifiedAt);
        Assert.Null(user.EmailVerificationToken);
        Assert.Null(user.EmailVerificationTokenExpiry);

        userRepoMock.Verify(x => x.Update(user), Times.Once);
        unitOfWorkMock.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Handle_ShouldRejectMissingTokenHash()
    {
        var unitOfWorkMock = new Mock<IAuthUnitOfWork>();
        var userRepoMock = new Mock<IUserRepository>();
        var loggerMock = new Mock<ILogger<VerifyEmailCommandHandler>>();

        unitOfWorkMock.SetupGet(x => x.Users).Returns(userRepoMock.Object);
        userRepoMock.Setup(x => x.GetByEmailVerificationTokenAsync(
                It.IsAny<string>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync((User?)null);

        var handler = new VerifyEmailCommandHandler(
            unitOfWorkMock.Object,
            loggerMock.Object);

        var result = await handler.Handle(
            new VerifyEmailCommand { Token = "wrong-token" },
            CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("INVALID_TOKEN", result.Error!.Code);
        unitOfWorkMock.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    [Trait("TestType", "Security")]
    [Trait("TestType", "Regression")]
    public async Task Handle_ShouldClearExpiredTokenAndRejectRequest()
    {
        const string verificationToken = "expired-token";
        var tokenHash = OpaqueToken.Hash(verificationToken);
        var user = User.Create(Email.Create("expired@example.com"), "password-hash", "Expired", "User");
        SetEmailVerificationTokenState(user, tokenHash, DateTime.UtcNow.AddMinutes(-1));
        var fixture = CreateFixture();
        fixture.Users
            .Setup(x => x.GetByEmailVerificationTokenAsync(tokenHash, It.IsAny<CancellationToken>()))
            .ReturnsAsync(user);
        fixture.UnitOfWork.Setup(x => x.SaveChangesAsync(It.IsAny<CancellationToken>())).ReturnsAsync(1);

        var result = await fixture.Handler.Handle(
            new VerifyEmailCommand { Token = verificationToken },
            CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("INVALID_TOKEN", result.Error!.Code);
        Assert.Null(user.EmailVerificationToken);
        Assert.Null(user.EmailVerificationTokenExpiry);
        fixture.Users.Verify(x => x.Update(user), Times.Once);
        fixture.UnitOfWork.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    [Trait("TestType", "Functional")]
    [Trait("TestType", "Regression")]
    public async Task Handle_ShouldClearTokenForAlreadyVerifiedUserWithoutReverifying()
    {
        const string verificationToken = "already-verified-token";
        var tokenHash = OpaqueToken.Hash(verificationToken);
        var user = User.Create(Email.Create("verified@example.com"), "password-hash", "Verified", "User");
        user.VerifyEmail();
        user.SetEmailVerificationToken(tokenHash, DateTime.UtcNow.AddHours(1));
        var verifiedAt = user.EmailVerifiedAt;
        var fixture = CreateFixture();
        fixture.Users
            .Setup(x => x.GetByEmailVerificationTokenAsync(tokenHash, It.IsAny<CancellationToken>()))
            .ReturnsAsync(user);
        fixture.UnitOfWork.Setup(x => x.SaveChangesAsync(It.IsAny<CancellationToken>())).ReturnsAsync(1);

        var result = await fixture.Handler.Handle(
            new VerifyEmailCommand { Token = verificationToken },
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(verifiedAt, user.EmailVerifiedAt);
        Assert.Null(user.EmailVerificationToken);
        fixture.Users.Verify(x => x.Update(user), Times.Once);
    }

    [Fact]
    [Trait("TestType", "Resilience")]
    [Trait("TestType", "Regression")]
    public async Task Handle_ShouldReturnInternalFailure_WhenDependencyThrows()
    {
        var fixture = CreateFixture();
        fixture.Users
            .Setup(x => x.GetByEmailVerificationTokenAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("repository unavailable"));

        var result = await fixture.Handler.Handle(
            new VerifyEmailCommand { Token = "boom" },
            CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("VERIFY_EMAIL_ERROR", result.Error!.Code);
    }

    [Fact]
    [Trait("TestType", "Functional")]
    [Trait("TestType", "Regression")]
    public async Task Resend_ShouldRequireAuthenticationAndExistingUser()
    {
        var unauthenticated = CreateResendFixture(null);

        var unauthenticatedResult = await unauthenticated.Handler.Handle(
            new ResendEmailVerificationCommand(),
            CancellationToken.None);

        Assert.True(unauthenticatedResult.IsFailure);
        Assert.Equal("NOT_AUTHENTICATED", unauthenticatedResult.Error!.Code);
        unauthenticated.Users.Verify(x => x.GetByIdAsync(It.IsAny<Guid>(), It.IsAny<CancellationToken>()), Times.Never);

        var userId = Guid.NewGuid();
        var missing = CreateResendFixture(userId);
        missing.Users.Setup(x => x.GetByIdAsync(userId, It.IsAny<CancellationToken>())).ReturnsAsync((User?)null);

        var missingResult = await missing.Handler.Handle(
            new ResendEmailVerificationCommand(),
            CancellationToken.None);

        Assert.True(missingResult.IsFailure);
        Assert.Equal("USER_NOT_FOUND", missingResult.Error!.Code);
        missing.EmailService.Verify(
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
    public async Task Resend_ShouldGenerateTokenPersistAndSendVerificationLink()
    {
        var user = User.Create(Email.Create("resend@example.com"), "password-hash", "Resend", "User");
        var fixture = CreateResendFixture(user.Id);
        string? sentLink = null;
        fixture.Users.Setup(x => x.GetByIdAsync(user.Id, It.IsAny<CancellationToken>())).ReturnsAsync(user);
        fixture.UnitOfWork.Setup(x => x.SaveChangesAsync(It.IsAny<CancellationToken>())).ReturnsAsync(1);
        fixture.EmailService
            .Setup(x => x.SendEmailVerificationAsync(
                user.Email.Value,
                user.FirstName,
                It.IsAny<string>(),
                It.IsAny<CancellationToken>()))
            .Callback<string, string, string, CancellationToken>((_, _, link, _) => sentLink = link)
            .Returns(Task.CompletedTask);

        var result = await fixture.Handler.Handle(
            new ResendEmailVerificationCommand(),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.NotNull(user.EmailVerificationToken);
        Assert.NotNull(user.EmailVerificationTokenExpiry);
        Assert.Contains("/auth/verify-email?token=", sentLink, StringComparison.Ordinal);
        fixture.Users.Verify(x => x.Update(user), Times.Once);
        fixture.UnitOfWork.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    [Trait("TestType", "Functional")]
    [Trait("TestType", "Regression")]
    public async Task Resend_ShouldSucceedWithoutSending_WhenEmailAlreadyVerified()
    {
        var user = User.Create(Email.Create("already@example.com"), "password-hash", "Already", "Verified");
        user.VerifyEmail();
        var fixture = CreateResendFixture(user.Id);
        fixture.Users.Setup(x => x.GetByIdAsync(user.Id, It.IsAny<CancellationToken>())).ReturnsAsync(user);

        var result = await fixture.Handler.Handle(
            new ResendEmailVerificationCommand(),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        fixture.Users.Verify(x => x.Update(It.IsAny<User>()), Times.Never);
        fixture.UnitOfWork.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Never);
        fixture.EmailService.Verify(
            x => x.SendEmailVerificationAsync(
                It.IsAny<string>(),
                It.IsAny<string>(),
                It.IsAny<string>(),
                It.IsAny<CancellationToken>()),
            Times.Never);
    }

    [Fact]
    public void Validator_ShouldRequireVerificationToken()
    {
        var validator = new VerifyEmailCommandValidator();

        var result = validator.Validate(new VerifyEmailCommand { Token = "" });

        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, error => error.PropertyName == nameof(VerifyEmailCommand.Token));
    }

    private static Fixture CreateFixture()
    {
        var unitOfWork = new Mock<IAuthUnitOfWork>();
        var users = new Mock<IUserRepository>();
        unitOfWork.SetupGet(x => x.Users).Returns(users.Object);
        return new Fixture(
            unitOfWork,
            users,
            new VerifyEmailCommandHandler(
                unitOfWork.Object,
                Mock.Of<ILogger<VerifyEmailCommandHandler>>()));
    }

    private static ResendFixture CreateResendFixture(Guid? userId)
    {
        var unitOfWork = new Mock<IAuthUnitOfWork>();
        var users = new Mock<IUserRepository>();
        var currentUser = new Mock<ICurrentUserService>();
        var emailService = new Mock<IEmailService>();
        var frontendOptions = Options.Create(new FrontendOptions { BaseUrl = "https://app.example.com/" });
        currentUser.SetupGet(x => x.UserId).Returns(userId);
        unitOfWork.SetupGet(x => x.Users).Returns(users.Object);

        return new ResendFixture(
            unitOfWork,
            users,
            emailService,
            new ResendEmailVerificationCommandHandler(
                unitOfWork.Object,
                currentUser.Object,
                emailService.Object,
                frontendOptions,
                Mock.Of<ILogger<ResendEmailVerificationCommandHandler>>()));
    }

    private static void SetEmailVerificationTokenState(User user, string tokenHash, DateTime expiresAt)
    {
        typeof(User).GetProperty(nameof(User.EmailVerificationToken))!.SetValue(user, tokenHash);
        typeof(User).GetProperty(nameof(User.EmailVerificationTokenExpiry))!.SetValue(user, expiresAt);
    }

    private sealed record Fixture(
        Mock<IAuthUnitOfWork> UnitOfWork,
        Mock<IUserRepository> Users,
        VerifyEmailCommandHandler Handler);

    private sealed record ResendFixture(
        Mock<IAuthUnitOfWork> UnitOfWork,
        Mock<IUserRepository> Users,
        Mock<IEmailService> EmailService,
        ResendEmailVerificationCommandHandler Handler);
}
