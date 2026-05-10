using Planora.Auth.Application.Features.Users.Commands.Enable2FA;
using Planora.Auth.Application.Features.Users.Handlers.Enable2FA;
using Planora.Auth.Application.Common.Interfaces;
using Planora.Auth.Domain.Entities;
using Planora.Auth.Domain.Repositories;
using Planora.Auth.Domain.ValueObjects;
using Microsoft.Extensions.Logging;
using Moq;

namespace Planora.UnitTests.Services.AuthApi.Users.Handlers;

public class Enable2FACommandHandlerTests
{
    [Fact]
    public async Task Handle_ShouldEnable2FA_AndReturnSecretAndQrCode()
    {
        var unitOfWorkMock = new Mock<IAuthUnitOfWork>();
        var userRepoMock = new Mock<IUserRepository>();
        unitOfWorkMock.SetupGet(x => x.Users).Returns(userRepoMock.Object);

        var twoFactorServiceMock = new Mock<ITwoFactorService>();
        var currentUserServiceMock = new Mock<ICurrentUserService>();
        var loggerMock = new Mock<ILogger<Enable2FACommandHandler>>();

        var email = Email.Create("user@example.com");
        var user = User.Create(email, "hashed", "First", "Last");

        currentUserServiceMock.SetupGet(x => x.UserId).Returns(user.Id);
        userRepoMock.Setup(x => x.GetByIdAsync(user.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(user);

        twoFactorServiceMock.Setup(x => x.GenerateSecret()).Returns("SECRET123");
        twoFactorServiceMock.Setup(x => x.GenerateQrCodeUrl(email.Value, "SECRET123"))
            .Returns("data:image/png;base64,AAAA");

        unitOfWorkMock.Setup(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(1);

        var handler = new Enable2FACommandHandler(
            unitOfWorkMock.Object,
            twoFactorServiceMock.Object,
            currentUserServiceMock.Object,
            loggerMock.Object);

        var result = await handler.Handle(new Enable2FACommand(), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.NotNull(result.Value);
        Assert.Equal("SECRET123", result.Value.Secret);
        Assert.Equal("data:image/png;base64,AAAA", result.Value.QrCodeUrl);
        Assert.True(user.TwoFactorEnabled);
        Assert.Equal("SECRET123", user.TwoFactorSecret);

        userRepoMock.Verify(x => x.Update(user), Times.Once);
        unitOfWorkMock.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    [Trait("TestType", "Security")]
    [Trait("TestType", "Regression")]
    public async Task Handle_ShouldReturnAuthNotFoundAndAlreadyEnabledFailuresBeforeMutation()
    {
        var unauthenticated = CreateFixture(null);
        var authResult = await unauthenticated.Handler.Handle(new Enable2FACommand(), CancellationToken.None);
        Assert.Equal("NOT_AUTHENTICATED", authResult.Error!.Code);
        unauthenticated.Users.Verify(x => x.GetByIdAsync(It.IsAny<Guid>(), It.IsAny<CancellationToken>()), Times.Never);

        var missingUserId = Guid.NewGuid();
        var missing = CreateFixture(missingUserId);
        missing.Users.Setup(x => x.GetByIdAsync(missingUserId, It.IsAny<CancellationToken>())).ReturnsAsync((User?)null);
        var missingResult = await missing.Handler.Handle(new Enable2FACommand(), CancellationToken.None);
        Assert.Equal("USER_NOT_FOUND", missingResult.Error!.Code);
        missing.TwoFactorService.Verify(x => x.GenerateSecret(), Times.Never);

        var user = User.Create(Email.Create("enabled@example.com"), "hashed", "Enabled", "User");
        user.EnableTwoFactor("existing-secret");
        var enabled = CreateFixture(user.Id);
        enabled.Users.Setup(x => x.GetByIdAsync(user.Id, It.IsAny<CancellationToken>())).ReturnsAsync(user);
        var enabledResult = await enabled.Handler.Handle(new Enable2FACommand(), CancellationToken.None);
        Assert.Equal("2FA_ALREADY_ENABLED", enabledResult.Error!.Code);
        enabled.TwoFactorService.Verify(x => x.GenerateSecret(), Times.Never);
    }

    private static Fixture CreateFixture(Guid? userId)
    {
        var unitOfWork = new Mock<IAuthUnitOfWork>();
        var users = new Mock<IUserRepository>();
        var twoFactorService = new Mock<ITwoFactorService>();
        var currentUser = new Mock<ICurrentUserService>();
        unitOfWork.SetupGet(x => x.Users).Returns(users.Object);
        currentUser.SetupGet(x => x.UserId).Returns(userId);

        return new Fixture(
            users,
            twoFactorService,
            new Enable2FACommandHandler(
                unitOfWork.Object,
                twoFactorService.Object,
                currentUser.Object,
                Mock.Of<ILogger<Enable2FACommandHandler>>()));
    }

    private sealed record Fixture(
        Mock<IUserRepository> Users,
        Mock<ITwoFactorService> TwoFactorService,
        Enable2FACommandHandler Handler);
}
