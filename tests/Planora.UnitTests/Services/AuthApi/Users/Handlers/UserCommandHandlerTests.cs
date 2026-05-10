using AutoMapper;
using Planora.Auth.Application.Common.DTOs;
using Planora.Auth.Application.Common.Interfaces;
using Planora.Auth.Application.Features.Users.Commands.Confirm2FA;
using Planora.Auth.Application.Features.Users.Commands.DeleteUser;
using Planora.Auth.Application.Features.Users.Commands.UpdateUser;
using Planora.Auth.Application.Features.Users.Handlers.Confirm2FA;
using Planora.Auth.Application.Features.Users.Handlers.DeleteUser;
using Planora.Auth.Application.Features.Users.Handlers.UpdateUser;
using Planora.Auth.Application.Features.Users.Validators.UpdateUser;
using Planora.Auth.Domain.Entities;
using Planora.Auth.Domain.Repositories;
using Planora.Auth.Domain.ValueObjects;
using Planora.BuildingBlocks.Infrastructure.Messaging;
using Planora.BuildingBlocks.Infrastructure.Messaging.Events;
using Microsoft.Extensions.Logging;
using Moq;

namespace Planora.UnitTests.Services.AuthApi.Users.Handlers;

public sealed class UserCommandHandlerTests
{
    [Fact]
    [Trait("TestType", "Functional")]
    [Trait("TestType", "Regression")]
    public async Task UpdateUser_ShouldRequireAuthenticationAndExistingUser()
    {
        var unauthenticated = CreateUpdateFixture(null);

        var unauthenticatedResult = await unauthenticated.Handler.Handle(
            new UpdateUserCommand { FirstName = "Ada", LastName = "Lovelace" },
            CancellationToken.None);

        Assert.True(unauthenticatedResult.IsFailure);
        Assert.Equal("NOT_AUTHENTICATED", unauthenticatedResult.Error!.Code);
        unauthenticated.Users.Verify(x => x.GetByIdAsync(It.IsAny<Guid>(), It.IsAny<CancellationToken>()), Times.Never);

        var missingUserId = Guid.NewGuid();
        var missing = CreateUpdateFixture(missingUserId);
        missing.Users.Setup(x => x.GetByIdAsync(missingUserId, It.IsAny<CancellationToken>())).ReturnsAsync((User?)null);

        var missingResult = await missing.Handler.Handle(
            new UpdateUserCommand { FirstName = "Ada", LastName = "Lovelace" },
            CancellationToken.None);

        Assert.True(missingResult.IsFailure);
        Assert.Equal("USER_NOT_FOUND", missingResult.Error!.Code);
        missing.UnitOfWork.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    [Trait("TestType", "Functional")]
    [Trait("TestType", "Regression")]
    public async Task UpdateUser_ShouldTrimProfileFieldsPersistAndMapDto()
    {
        var user = CreateUser("profile@example.com", "Old", "Name");
        var dto = new UserDto { Id = user.Id, Email = user.Email.Value, FirstName = "Ada", LastName = "Lovelace" };
        var fixture = CreateUpdateFixture(user.Id);
        fixture.Users.Setup(x => x.GetByIdAsync(user.Id, It.IsAny<CancellationToken>())).ReturnsAsync(user);
        fixture.UnitOfWork.Setup(x => x.SaveChangesAsync(It.IsAny<CancellationToken>())).ReturnsAsync(1);
        fixture.Mapper.Setup(x => x.Map<UserDto>(user)).Returns(dto);

        var result = await fixture.Handler.Handle(
            new UpdateUserCommand
            {
                FirstName = "  Ada  ",
                LastName = "  Lovelace  ",
                ProfilePictureUrl = " https://example.com/avatar.png "
            },
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Same(dto, result.Value);
        Assert.Equal("Ada", user.FirstName);
        Assert.Equal("Lovelace", user.LastName);
        Assert.Equal("https://example.com/avatar.png", user.ProfilePictureUrl);
        fixture.Users.Verify(x => x.Update(user), Times.Once);
        fixture.UnitOfWork.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    [Trait("TestType", "Functional")]
    [Trait("TestType", "Regression")]
    public async Task DeleteUser_ShouldRequireAuthenticationExistingUserAndValidPassword()
    {
        var unauthenticated = CreateDeleteFixture(null);

        var unauthenticatedResult = await unauthenticated.Handler.Handle(
            new DeleteUserCommand { Password = "Password123!" },
            CancellationToken.None);

        Assert.True(unauthenticatedResult.IsFailure);
        Assert.Equal("NOT_AUTHENTICATED", unauthenticatedResult.Error!.Code);

        var userId = Guid.NewGuid();
        var missing = CreateDeleteFixture(userId);
        missing.Users.Setup(x => x.GetByIdAsync(userId, It.IsAny<CancellationToken>())).ReturnsAsync((User?)null);

        var missingResult = await missing.Handler.Handle(
            new DeleteUserCommand { Password = "Password123!" },
            CancellationToken.None);

        Assert.True(missingResult.IsFailure);
        Assert.Equal("USER_NOT_FOUND", missingResult.Error!.Code);

        var user = CreateUser("delete@example.com", "Delete", "User");
        var invalidPassword = CreateDeleteFixture(user.Id);
        invalidPassword.Users.Setup(x => x.GetByIdAsync(user.Id, It.IsAny<CancellationToken>())).ReturnsAsync(user);
        invalidPassword.PasswordHasher.Setup(x => x.VerifyPassword("wrong", user.PasswordHash)).Returns(false);

        var invalidPasswordResult = await invalidPassword.Handler.Handle(
            new DeleteUserCommand { Password = "wrong" },
            CancellationToken.None);

        Assert.True(invalidPasswordResult.IsFailure);
        Assert.Equal("INVALID_PASSWORD", invalidPasswordResult.Error!.Code);
        invalidPassword.UnitOfWork.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Never);
        invalidPassword.EventBus.Verify(x => x.PublishAsync(It.IsAny<UserDeletedIntegrationEvent>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    [Trait("TestType", "Functional")]
    [Trait("TestType", "Integration")]
    [Trait("TestType", "Regression")]
    public async Task DeleteUser_ShouldSoftDeleteDeactivatePersistAndPublishCleanupEvent()
    {
        var user = CreateUser("delete-success@example.com", "Delete", "Success");
        var fixture = CreateDeleteFixture(user.Id);
        UserDeletedIntegrationEvent? publishedEvent = null;
        fixture.Users.Setup(x => x.GetByIdAsync(user.Id, It.IsAny<CancellationToken>())).ReturnsAsync(user);
        fixture.PasswordHasher.Setup(x => x.VerifyPassword("Password123!", user.PasswordHash)).Returns(true);
        fixture.UnitOfWork.Setup(x => x.SaveChangesAsync(It.IsAny<CancellationToken>())).ReturnsAsync(1);
        fixture.EventBus
            .Setup(x => x.PublishAsync(It.IsAny<UserDeletedIntegrationEvent>(), It.IsAny<CancellationToken>()))
            .Callback<UserDeletedIntegrationEvent, CancellationToken>((@event, _) => publishedEvent = @event)
            .Returns(Task.CompletedTask);

        var result = await fixture.Handler.Handle(
            new DeleteUserCommand { Password = "Password123!" },
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.True(user.IsDeleted);
        Assert.False(user.IsActive);
        Assert.Equal(user.Id, user.DeletedBy);
        fixture.Users.Verify(x => x.Update(user), Times.Once);
        fixture.UnitOfWork.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Once);
        Assert.NotNull(publishedEvent);
        Assert.Equal(user.Id, publishedEvent!.UserId);
        Assert.Equal(user.Email.Value, publishedEvent.Email);
    }

    [Fact]
    [Trait("TestType", "Security")]
    [Trait("TestType", "Regression")]
    public async Task Confirm2FA_ShouldRequireAuthenticationExistingUserAndSetup()
    {
        var unauthenticated = CreateConfirm2FaFixture(null);

        var unauthenticatedResult = await unauthenticated.Handler.Handle(
            new Confirm2FACommand { Code = "123456" },
            CancellationToken.None);

        Assert.True(unauthenticatedResult.IsFailure);
        Assert.Equal("NOT_AUTHENTICATED", unauthenticatedResult.Error!.Code);
        unauthenticated.Users.Verify(x => x.GetByIdAsync(It.IsAny<Guid>(), It.IsAny<CancellationToken>()), Times.Never);

        var missingUserId = Guid.NewGuid();
        var missing = CreateConfirm2FaFixture(missingUserId);
        missing.Users.Setup(x => x.GetByIdAsync(missingUserId, It.IsAny<CancellationToken>())).ReturnsAsync((User?)null);

        var missingResult = await missing.Handler.Handle(
            new Confirm2FACommand { Code = "123456" },
            CancellationToken.None);

        Assert.True(missingResult.IsFailure);
        Assert.Equal("USER_NOT_FOUND", missingResult.Error!.Code);

        var userWithoutSetup = CreateUser("no-2fa@example.com", "No", "Setup");
        var notSetup = CreateConfirm2FaFixture(userWithoutSetup.Id);
        notSetup.Users.Setup(x => x.GetByIdAsync(userWithoutSetup.Id, It.IsAny<CancellationToken>())).ReturnsAsync(userWithoutSetup);

        var notSetupResult = await notSetup.Handler.Handle(
            new Confirm2FACommand { Code = "123456" },
            CancellationToken.None);

        Assert.True(notSetupResult.IsFailure);
        Assert.Equal("2FA_NOT_SETUP", notSetupResult.Error!.Code);
        notSetup.TwoFactorService.Verify(x => x.VerifyCode(It.IsAny<string>(), It.IsAny<string>()), Times.Never);
    }

    [Fact]
    [Trait("TestType", "Security")]
    [Trait("TestType", "Regression")]
    public async Task Confirm2FA_ShouldRejectInvalidCodeAndAcceptValidCode()
    {
        var user = CreateUser("confirm-2fa@example.com", "Confirm", "User");
        user.EnableTwoFactor("SECRET");
        var invalid = CreateConfirm2FaFixture(user.Id);
        invalid.Users.Setup(x => x.GetByIdAsync(user.Id, It.IsAny<CancellationToken>())).ReturnsAsync(user);
        invalid.TwoFactorService.Setup(x => x.VerifyCode("SECRET", "000000")).Returns(false);

        var invalidResult = await invalid.Handler.Handle(
            new Confirm2FACommand { Code = "000000" },
            CancellationToken.None);

        Assert.True(invalidResult.IsFailure);
        Assert.Equal("INVALID_2FA_CODE", invalidResult.Error!.Code);

        var valid = CreateConfirm2FaFixture(user.Id);
        valid.Users.Setup(x => x.GetByIdAsync(user.Id, It.IsAny<CancellationToken>())).ReturnsAsync(user);
        valid.TwoFactorService.Setup(x => x.VerifyCode("SECRET", "123456")).Returns(true);

        var validResult = await valid.Handler.Handle(
            new Confirm2FACommand { Code = "123456" },
            CancellationToken.None);

        Assert.True(validResult.IsSuccess);
        valid.UnitOfWork.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    [Trait("TestType", "Resilience")]
    [Trait("TestType", "Regression")]
    public async Task Confirm2FA_ShouldReturnInternalFailure_WhenDependencyThrows()
    {
        var userId = Guid.NewGuid();
        var fixture = CreateConfirm2FaFixture(userId);
        fixture.Users
            .Setup(x => x.GetByIdAsync(userId, It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("repository unavailable"));

        var result = await fixture.Handler.Handle(
            new Confirm2FACommand { Code = "123456" },
            CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("CONFIRM_2FA_ERROR", result.Error!.Code);
    }

    [Fact]
    [Trait("TestType", "Unit")]
    [Trait("TestType", "Regression")]
    public void UpdateUserCommandValidator_ShouldValidateNamesAndOptionalProfileUrl()
    {
        var validator = new UpdateUserCommandValidator();

        Assert.True(validator.Validate(new UpdateUserCommand
        {
            FirstName = "Ada",
            LastName = "Lovelace",
            ProfilePictureUrl = "https://example.com/avatar.png"
        }).IsValid);

        var invalid = validator.Validate(new UpdateUserCommand
        {
            FirstName = "Ada123",
            LastName = "",
            ProfilePictureUrl = "ftp://example.com/avatar.png"
        });

        Assert.False(invalid.IsValid);
        Assert.Contains(invalid.Errors, error => error.PropertyName == nameof(UpdateUserCommand.FirstName));
        Assert.Contains(invalid.Errors, error => error.PropertyName == nameof(UpdateUserCommand.LastName));
        Assert.Contains(invalid.Errors, error => error.PropertyName == nameof(UpdateUserCommand.ProfilePictureUrl));

        var tooLong = validator.Validate(new UpdateUserCommand
        {
            FirstName = new string('A', 101),
            LastName = "Lovelace",
            ProfilePictureUrl = new string('a', 501)
        });

        Assert.Contains(tooLong.Errors, error => error.PropertyName == nameof(UpdateUserCommand.FirstName));
        Assert.Contains(tooLong.Errors, error => error.PropertyName == nameof(UpdateUserCommand.ProfilePictureUrl));

        var method = typeof(UpdateUserCommandValidator).GetMethod(
            "BeValidUrl",
            System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic)!;
        Assert.True((bool)method.Invoke(validator, new object?[] { null })!);
    }

    private static UpdateFixture CreateUpdateFixture(Guid? currentUserId)
    {
        var unitOfWork = new Mock<IAuthUnitOfWork>();
        var users = new Mock<IUserRepository>();
        var currentUser = new Mock<ICurrentUserService>();
        var mapper = new Mock<IMapper>();
        unitOfWork.SetupGet(x => x.Users).Returns(users.Object);
        currentUser.SetupGet(x => x.UserId).Returns(currentUserId);

        return new UpdateFixture(
            unitOfWork,
            users,
            mapper,
            new UpdateUserCommandHandler(
                unitOfWork.Object,
                currentUser.Object,
                mapper.Object,
                Mock.Of<ILogger<UpdateUserCommandHandler>>()));
    }

    private static DeleteFixture CreateDeleteFixture(Guid? currentUserId)
    {
        var unitOfWork = new Mock<IAuthUnitOfWork>();
        var users = new Mock<IUserRepository>();
        var passwordHasher = new Mock<IPasswordHasher>();
        var currentUser = new Mock<ICurrentUserService>();
        var eventBus = new Mock<IEventBus>();
        unitOfWork.SetupGet(x => x.Users).Returns(users.Object);
        currentUser.SetupGet(x => x.UserId).Returns(currentUserId);

        return new DeleteFixture(
            unitOfWork,
            users,
            passwordHasher,
            eventBus,
            new DeleteUserCommandHandler(
                unitOfWork.Object,
                passwordHasher.Object,
                currentUser.Object,
                eventBus.Object,
                Mock.Of<ILogger<DeleteUserCommandHandler>>()));
    }

    private static Confirm2FaFixture CreateConfirm2FaFixture(Guid? currentUserId)
    {
        var unitOfWork = new Mock<IAuthUnitOfWork>();
        var users = new Mock<IUserRepository>();
        var twoFactorService = new Mock<ITwoFactorService>();
        var currentUser = new Mock<ICurrentUserService>();
        unitOfWork.SetupGet(x => x.Users).Returns(users.Object);
        currentUser.SetupGet(x => x.UserId).Returns(currentUserId);

        return new Confirm2FaFixture(
            unitOfWork,
            users,
            twoFactorService,
            new Confirm2FACommandHandler(
                unitOfWork.Object,
                twoFactorService.Object,
                currentUser.Object,
                Mock.Of<ILogger<Confirm2FACommandHandler>>()));
    }

    private static User CreateUser(string email, string firstName, string lastName)
    {
        var user = User.Create(Email.Create(email), "hashed-password", firstName, lastName);
        user.VerifyEmail();
        user.ClearDomainEvents();
        return user;
    }

    private sealed record UpdateFixture(
        Mock<IAuthUnitOfWork> UnitOfWork,
        Mock<IUserRepository> Users,
        Mock<IMapper> Mapper,
        UpdateUserCommandHandler Handler);

    private sealed record DeleteFixture(
        Mock<IAuthUnitOfWork> UnitOfWork,
        Mock<IUserRepository> Users,
        Mock<IPasswordHasher> PasswordHasher,
        Mock<IEventBus> EventBus,
        DeleteUserCommandHandler Handler);

    private sealed record Confirm2FaFixture(
        Mock<IAuthUnitOfWork> UnitOfWork,
        Mock<IUserRepository> Users,
        Mock<ITwoFactorService> TwoFactorService,
        Confirm2FACommandHandler Handler);
}
