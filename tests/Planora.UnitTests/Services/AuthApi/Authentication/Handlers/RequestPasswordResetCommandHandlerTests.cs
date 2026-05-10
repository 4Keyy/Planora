using Planora.Auth.Application.Common.Interfaces;
using Planora.Auth.Application.Common.Options;
using Planora.Auth.Application.Features.Authentication.Commands.RequestPasswordReset;
using Planora.Auth.Application.Features.Authentication.Handlers.RequestPasswordReset;
using Planora.Auth.Domain.Entities;
using Planora.Auth.Domain.Repositories;
using Planora.Auth.Domain.ValueObjects;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Moq;

namespace Planora.UnitTests.Services.AuthApi.Authentication.Handlers;

public sealed class RequestPasswordResetCommandHandlerTests
{
    [Fact]
    [Trait("TestType", "Security")]
    [Trait("TestType", "Regression")]
    public async Task Handle_ShouldReturnSuccessWithoutLookup_WhenEmailFormatIsInvalid()
    {
        var fixture = CreateFixture();

        var result = await fixture.Handler.Handle(
            new RequestPasswordResetCommand { Email = "not-an-email" },
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        fixture.Users.Verify(x => x.GetByEmailAsync(It.IsAny<Email>(), It.IsAny<CancellationToken>()), Times.Never);
        fixture.TokenService.Verify(x => x.GenerateToken(), Times.Never);
        fixture.EmailService.Verify(x => x.SendPasswordResetEmailAsync(
            It.IsAny<string>(),
            It.IsAny<string>(),
            It.IsAny<string>(),
            It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    [Trait("TestType", "Security")]
    [Trait("TestType", "Regression")]
    public async Task Handle_ShouldReturnSuccessWithoutToken_WhenUserDoesNotExistOrIsLocked()
    {
        var missing = CreateFixture();
        missing.Users
            .Setup(x => x.GetByEmailAsync(Email.Create("missing@example.com"), It.IsAny<CancellationToken>()))
            .ReturnsAsync((User?)null);

        var missingResult = await missing.Handler.Handle(
            new RequestPasswordResetCommand { Email = "missing@example.com" },
            CancellationToken.None);

        Assert.True(missingResult.IsSuccess);
        missing.TokenService.Verify(x => x.GenerateToken(), Times.Never);

        var lockedUser = CreateUser("locked@example.com");
        lockedUser.LockAccount();
        var locked = CreateFixture();
        locked.Users
            .Setup(x => x.GetByEmailAsync(lockedUser.Email, It.IsAny<CancellationToken>()))
            .ReturnsAsync(lockedUser);

        var lockedResult = await locked.Handler.Handle(
            new RequestPasswordResetCommand { Email = lockedUser.Email.Value },
            CancellationToken.None);

        Assert.True(lockedResult.IsSuccess);
        locked.TokenService.Verify(x => x.GenerateToken(), Times.Never);
        locked.Users.Verify(x => x.Update(It.IsAny<User>()), Times.Never);
        locked.UnitOfWork.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    [Trait("TestType", "Functional")]
    [Trait("TestType", "Security")]
    [Trait("TestType", "Regression")]
    public async Task Handle_ShouldPersistHashedTokenAndSendNormalizedResetLink()
    {
        var user = CreateUser("reset@example.com");
        var fixture = CreateFixture("https://app.example.com/");
        string? resetLink = null;
        fixture.Users
            .Setup(x => x.GetByEmailAsync(user.Email, It.IsAny<CancellationToken>()))
            .ReturnsAsync(user);
        fixture.TokenService.SetupGet(x => x.TokenLifetime).Returns(TimeSpan.FromMinutes(30));
        fixture.TokenService.Setup(x => x.GenerateToken()).Returns("token with space");
        fixture.TokenService.Setup(x => x.HashToken("token with space")).Returns("token-hash");
        fixture.UnitOfWork.Setup(x => x.SaveChangesAsync(It.IsAny<CancellationToken>())).ReturnsAsync(1);
        fixture.EmailService
            .Setup(x => x.SendPasswordResetEmailAsync(
                user.Email.Value,
                user.FirstName,
                It.IsAny<string>(),
                It.IsAny<CancellationToken>()))
            .Callback<string, string, string, CancellationToken>((_, _, link, _) => resetLink = link)
            .Returns(Task.CompletedTask);

        var result = await fixture.Handler.Handle(
            new RequestPasswordResetCommand { Email = user.Email.Value },
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal("token-hash", user.PasswordResetToken);
        Assert.True(user.PasswordResetTokenExpiry > DateTime.UtcNow.AddMinutes(29));
        Assert.Equal("https://app.example.com/reset-password?token=token%20with%20space", resetLink);
        fixture.Users.Verify(x => x.Update(user), Times.Once);
        fixture.UnitOfWork.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    [Trait("TestType", "Resilience")]
    [Trait("TestType", "Regression")]
    public async Task Handle_ShouldStillReturnSuccess_WhenDependencyThrows()
    {
        var fixture = CreateFixture();
        fixture.Users
            .Setup(x => x.GetByEmailAsync(It.IsAny<Email>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("database unavailable"));

        var result = await fixture.Handler.Handle(
            new RequestPasswordResetCommand { Email = "user@example.com" },
            CancellationToken.None);

        Assert.True(result.IsSuccess);
    }

    private static Fixture CreateFixture(string baseUrl = "http://localhost:3000")
    {
        var unitOfWork = new Mock<IAuthUnitOfWork>();
        var users = new Mock<IUserRepository>();
        var emailService = new Mock<IEmailService>();
        var tokenService = new Mock<IPasswordResetTokenService>();
        unitOfWork.SetupGet(x => x.Users).Returns(users.Object);

        return new Fixture(
            unitOfWork,
            users,
            emailService,
            tokenService,
            new RequestPasswordResetCommandHandler(
                unitOfWork.Object,
                emailService.Object,
                tokenService.Object,
                Options.Create(new FrontendOptions { BaseUrl = baseUrl }),
                Mock.Of<ILogger<RequestPasswordResetCommandHandler>>()));
    }

    private static User CreateUser(string email)
    {
        var user = User.Create(Email.Create(email), "password-hash", "Reset", "User");
        user.VerifyEmail();
        user.ClearDomainEvents();
        return user;
    }

    private sealed record Fixture(
        Mock<IAuthUnitOfWork> UnitOfWork,
        Mock<IUserRepository> Users,
        Mock<IEmailService> EmailService,
        Mock<IPasswordResetTokenService> TokenService,
        RequestPasswordResetCommandHandler Handler);
}
