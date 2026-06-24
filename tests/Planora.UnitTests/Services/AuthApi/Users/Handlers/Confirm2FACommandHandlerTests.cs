using Planora.Auth.Application.Features.Users.Commands.Confirm2FA;
using Planora.Auth.Application.Features.Users.Handlers.Confirm2FA;
using Planora.Auth.Application.Common.Interfaces;
using Planora.Auth.Domain.Entities;
using Planora.Auth.Domain.Repositories;
using Planora.Auth.Domain.ValueObjects;
using Microsoft.Extensions.Logging;
using Moq;

namespace Planora.UnitTests.Services.AuthApi.Users.Handlers;

public class Confirm2FACommandHandlerTests
{
    [Fact]
    public async Task Handle_ShouldConfirm2FA_WhenCodeIsValid()
    {
        var unitOfWorkMock = new Mock<IAuthUnitOfWork>();
        var userRepoMock = new Mock<IUserRepository>();
        unitOfWorkMock.SetupGet(x => x.Users).Returns(userRepoMock.Object);

        var twoFactorServiceMock = new Mock<ITwoFactorService>();
        var currentUserServiceMock = new Mock<ICurrentUserService>();
        var loggerMock = new Mock<ILogger<Confirm2FACommandHandler>>();

        var email = Email.Create("user@example.com");
        var user = User.Create(email, "hashed", "First", "Last");
        // Pending enrolment: secret stored, 2FA not yet active.
        user.BeginTwoFactorSetup("SECRET123");
        Assert.False(user.TwoFactorEnabled);

        currentUserServiceMock.SetupGet(x => x.UserId).Returns(user.Id);
        userRepoMock.Setup(x => x.GetByIdAsync(user.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(user);
        unitOfWorkMock.Setup(x => x.SaveChangesAsync(It.IsAny<CancellationToken>())).ReturnsAsync(1);

        twoFactorServiceMock.Setup(x => x.VerifyCodeAsync("SECRET123", "123456", It.IsAny<Guid>(), It.IsAny<CancellationToken>())).ReturnsAsync(true);

        var handler = new Confirm2FACommandHandler(
            unitOfWorkMock.Object,
            twoFactorServiceMock.Object,
            currentUserServiceMock.Object,
            Mock.Of<IRecoveryCodeService>(),
            loggerMock.Object);

        var result = await handler.Handle(new Confirm2FACommand { Code = "123456" }, CancellationToken.None);

        Assert.True(result.IsSuccess);
        // Confirmation activates 2FA and persists the change.
        Assert.True(user.TwoFactorEnabled);
        Assert.True(user.IsTwoFactorEnabled);
        Assert.False(user.IsTwoFactorPending);
        twoFactorServiceMock.Verify(x => x.VerifyCodeAsync("SECRET123", "123456", It.IsAny<Guid>(), It.IsAny<CancellationToken>()), Times.Once);
        userRepoMock.Verify(x => x.Update(user), Times.Once);
        unitOfWorkMock.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    [Trait("TestType", "Security")]
    public async Task Handle_ShouldReject_WhenSetupNotStarted()
    {
        var unitOfWorkMock = new Mock<IAuthUnitOfWork>();
        var userRepoMock = new Mock<IUserRepository>();
        unitOfWorkMock.SetupGet(x => x.Users).Returns(userRepoMock.Object);
        var twoFactorServiceMock = new Mock<ITwoFactorService>();
        var currentUserServiceMock = new Mock<ICurrentUserService>();

        var user = User.Create(Email.Create("nopending@example.com"), "hashed", "No", "Pending");
        currentUserServiceMock.SetupGet(x => x.UserId).Returns(user.Id);
        userRepoMock.Setup(x => x.GetByIdAsync(user.Id, It.IsAny<CancellationToken>())).ReturnsAsync(user);

        var handler = new Confirm2FACommandHandler(
            unitOfWorkMock.Object,
            twoFactorServiceMock.Object,
            currentUserServiceMock.Object,
            Mock.Of<IRecoveryCodeService>(),
            Mock.Of<ILogger<Confirm2FACommandHandler>>());

        var result = await handler.Handle(new Confirm2FACommand { Code = "123456" }, CancellationToken.None);

        Assert.False(result.IsSuccess);
        Assert.Equal("2FA_NOT_SETUP", result.Error!.Code);
        twoFactorServiceMock.Verify(
            x => x.VerifyCodeAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<Guid>(), It.IsAny<CancellationToken>()),
            Times.Never);
    }
}
