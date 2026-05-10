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
        user.EnableTwoFactor("SECRET123");

        currentUserServiceMock.SetupGet(x => x.UserId).Returns(user.Id);
        userRepoMock.Setup(x => x.GetByIdAsync(user.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(user);

        twoFactorServiceMock.Setup(x => x.VerifyCode("SECRET123", "123456")).Returns(true);

        var handler = new Confirm2FACommandHandler(
            unitOfWorkMock.Object,
            twoFactorServiceMock.Object,
            currentUserServiceMock.Object,
            loggerMock.Object);

        var result = await handler.Handle(new Confirm2FACommand { Code = "123456" }, CancellationToken.None);

        Assert.True(result.IsSuccess);
        twoFactorServiceMock.Verify(x => x.VerifyCode("SECRET123", "123456"), Times.Once);
    }
}
