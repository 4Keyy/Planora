using AutoMapper;
using Planora.Auth.Application.Common.DTOs;
using Planora.Auth.Application.Common.Interfaces;
using Planora.Auth.Application.Features.Users.Commands.UploadAvatar;
using Planora.Auth.Application.Features.Users.Handlers.UploadAvatar;
using Planora.Auth.Domain.Entities;
using Planora.Auth.Domain.Repositories;
using Planora.Auth.Domain.ValueObjects;
using Planora.BuildingBlocks.Domain;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;
using Moq;

namespace Planora.UnitTests.Services.AuthApi.Users.Handlers;

public sealed class UploadAvatarCommandHandlerTests
{
    [Fact]
    [Trait("TestType", "Functional")]
    public async Task UploadAvatar_ShouldRejectWhenNotAuthenticated()
    {
        var fixture = CreateFixture(userId: null);

        var result = await fixture.Handler.Handle(
            new UploadAvatarCommand { File = CreateFile(new byte[1]) },
            CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("NOT_AUTHENTICATED", result.Error!.Code);
        fixture.Users.Verify(x => x.GetByIdAsync(It.IsAny<Guid>(), It.IsAny<CancellationToken>()), Times.Never);
        fixture.Storage.Verify(x => x.SaveBytesAsync(
            It.IsAny<byte[]>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>()),
            Times.Never);
    }

    [Fact]
    [Trait("TestType", "Functional")]
    public async Task UploadAvatar_ShouldReturnNotFoundWhenUserMissing()
    {
        var userId = Guid.NewGuid();
        var fixture = CreateFixture(userId);
        fixture.Users.Setup(x => x.GetByIdAsync(userId, It.IsAny<CancellationToken>())).ReturnsAsync((User?)null);

        var result = await fixture.Handler.Handle(
            new UploadAvatarCommand { File = CreateFile(new byte[1]) },
            CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("USER_NOT_FOUND", result.Error!.Code);
    }

    [Fact]
    [Trait("TestType", "Security")]
    public async Task UploadAvatar_ShouldPropagateProcessorRejectionWithoutTouchingStorage()
    {
        var user = CreateUser();
        var fixture = CreateFixture(user.Id);
        fixture.Users.Setup(x => x.GetByIdAsync(user.Id, It.IsAny<CancellationToken>())).ReturnsAsync(user);
        fixture.Processor
            .Setup(x => x.ProcessAvatarAsync(It.IsAny<Stream>(), It.IsAny<long>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result<ProcessedImage>.Failure(Error.Validation("INVALID_FILE_SIZE", "too big")));

        var result = await fixture.Handler.Handle(
            new UploadAvatarCommand { File = CreateFile(new byte[1]) },
            CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("INVALID_FILE_SIZE", result.Error!.Code);
        fixture.Storage.Verify(x => x.SaveBytesAsync(
            It.IsAny<byte[]>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>()),
            Times.Never);
        fixture.UnitOfWork.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    [Trait("TestType", "Functional")]
    public async Task UploadAvatar_ShouldDeleteOldAvatarAndPersistNewUrl()
    {
        var user = CreateUser(existingAvatarUrl: "/avatars/old-deadbeef.webp");
        var processedBytes = new byte[] { 1, 2, 3, 4 };
        var savedUrl = "/avatars/avatar-newhash.webp";

        var fixture = CreateFixture(user.Id);
        fixture.Users.Setup(x => x.GetByIdAsync(user.Id, It.IsAny<CancellationToken>())).ReturnsAsync(user);
        fixture.Processor
            .Setup(x => x.ProcessAvatarAsync(It.IsAny<Stream>(), It.IsAny<long>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result<ProcessedImage>.Success(
                new ProcessedImage(processedBytes, "image/webp", ".webp", 128, 128)));
        fixture.Storage
            .Setup(x => x.SaveBytesAsync(processedBytes, It.IsAny<string>(), "avatars", It.IsAny<CancellationToken>()))
            .ReturnsAsync(savedUrl);
        fixture.UnitOfWork.Setup(x => x.SaveChangesAsync(It.IsAny<CancellationToken>())).ReturnsAsync(1);
        fixture.Mapper.Setup(x => x.Map<UserDto>(user))
            .Returns(new UserDto { Id = user.Id, Email = user.Email.Value, ProfilePictureUrl = savedUrl });

        var result = await fixture.Handler.Handle(
            new UploadAvatarCommand { File = CreateFile(new byte[1]) },
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(savedUrl, result.Value!.ProfilePictureUrl);
        fixture.Storage.Verify(x => x.DeleteFile("/avatars/old-deadbeef.webp"), Times.Once);
        fixture.Storage.Verify(x => x.SaveBytesAsync(processedBytes,
            It.Is<string>(name => name.EndsWith(".webp")),
            "avatars", It.IsAny<CancellationToken>()), Times.Once);
        fixture.UnitOfWork.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Once);
        Assert.Equal(savedUrl, user.ProfilePictureUrl);
    }

    [Fact]
    [Trait("TestType", "Security")]
    public async Task UploadAvatar_ShouldNotDeleteExternallyHostedAvatar()
    {
        var user = CreateUser(existingAvatarUrl: "https://cdn.example.com/old.png");
        var fixture = CreateFixture(user.Id);
        fixture.Users.Setup(x => x.GetByIdAsync(user.Id, It.IsAny<CancellationToken>())).ReturnsAsync(user);
        fixture.Processor
            .Setup(x => x.ProcessAvatarAsync(It.IsAny<Stream>(), It.IsAny<long>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result<ProcessedImage>.Success(new ProcessedImage(new byte[] { 1 }, "image/webp", ".webp", 128, 128)));
        fixture.Storage
            .Setup(x => x.SaveBytesAsync(It.IsAny<byte[]>(), It.IsAny<string>(), "avatars", It.IsAny<CancellationToken>()))
            .ReturnsAsync("/avatars/avatar-new.webp");
        fixture.Mapper.Setup(x => x.Map<UserDto>(user)).Returns(new UserDto { Id = user.Id, Email = user.Email.Value });

        var result = await fixture.Handler.Handle(
            new UploadAvatarCommand { File = CreateFile(new byte[1]) },
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        fixture.Storage.Verify(x => x.DeleteFile(It.IsAny<string>()), Times.Never);
    }

    private static User CreateUser(string? existingAvatarUrl = null)
    {
        var user = User.Create(Planora.Auth.Domain.ValueObjects.Email.Create("user@example.com"), "hashed-password", "Ada", "Lovelace");
        user.VerifyEmail();
        user.ClearDomainEvents();
        if (existingAvatarUrl is not null)
        {
            user.UpdateProfile(user.FirstName, user.LastName, existingAvatarUrl, user.Id);
        }
        return user;
    }

    private static IFormFile CreateFile(byte[] payload, string contentType = "image/png", string fileName = "avatar.png")
    {
        var stream = new MemoryStream(payload);
        return new FormFile(stream, 0, payload.Length, "file", fileName)
        {
            Headers = new HeaderDictionary(),
            ContentType = contentType,
        };
    }

    private static Fixture CreateFixture(Guid? userId)
    {
        var users = new Mock<IUserRepository>();
        var uow = new Mock<IAuthUnitOfWork>();
        uow.SetupGet(x => x.Users).Returns(users.Object);

        var current = new Mock<ICurrentUserService>();
        current.SetupGet(x => x.UserId).Returns(userId);

        var storage = new Mock<IFileStorageService>();
        var processor = new Mock<IImageProcessor>();
        var mapper = new Mock<IMapper>();
        var logger = new Mock<ILogger<UploadAvatarCommandHandler>>();

        var handler = new UploadAvatarCommandHandler(
            uow.Object,
            current.Object,
            storage.Object,
            processor.Object,
            mapper.Object,
            logger.Object);

        return new Fixture(handler, users, uow, current, storage, processor, mapper);
    }

    private sealed record Fixture(
        UploadAvatarCommandHandler Handler,
        Mock<IUserRepository> Users,
        Mock<IAuthUnitOfWork> UnitOfWork,
        Mock<ICurrentUserService> Current,
        Mock<IFileStorageService> Storage,
        Mock<IImageProcessor> Processor,
        Mock<IMapper> Mapper);
}
