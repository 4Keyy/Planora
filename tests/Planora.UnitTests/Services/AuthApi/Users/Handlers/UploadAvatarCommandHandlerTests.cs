using AutoMapper;
using Planora.Auth.Application.Common.DTOs;
using Planora.Auth.Application.Common.Interfaces;
using Planora.Auth.Application.Features.Users.Commands.UploadAvatar;
using Planora.Auth.Application.Features.Users.Handlers.UploadAvatar;
using Planora.Auth.Domain.Entities;
using Planora.Auth.Domain.Repositories;
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
        fixture.AvatarStorage.Verify(x => x.PutAsync(
            It.IsAny<Guid>(), It.IsAny<ProcessedAvatar>(), It.IsAny<CancellationToken>()),
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
            .ReturnsAsync(Result<ProcessedAvatar>.Failure(Error.Validation("INVALID_FILE_SIZE", "too big")));

        var result = await fixture.Handler.Handle(
            new UploadAvatarCommand { File = CreateFile(new byte[1]) },
            CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("INVALID_FILE_SIZE", result.Error!.Code);
        fixture.AvatarStorage.Verify(x => x.PutAsync(
            It.IsAny<Guid>(), It.IsAny<ProcessedAvatar>(), It.IsAny<CancellationToken>()),
            Times.Never);
        fixture.UnitOfWork.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    [Trait("TestType", "Functional")]
    public async Task UploadAvatar_ShouldStoreVariantsAndPersistCanonicalUrl()
    {
        var user = CreateUser(existingAvatarUrl: "/avatars/oldhash/128.webp");
        var processed = new ProcessedAvatar(
            ContentHash: "abc123",
            Variants: new[]
            {
                new AvatarVariant(AvatarSize.Small, new byte[] { 1 }, "image/webp", ".webp", 64, 64),
                new AvatarVariant(AvatarSize.Medium, new byte[] { 2 }, "image/webp", ".webp", 128, 128),
                new AvatarVariant(AvatarSize.Large, new byte[] { 3 }, "image/webp", ".webp", 512, 512),
            });
        var manifest = new AvatarManifest(
            SmallUrl: $"/avatars/{user.Id:N}/abc123/64.webp",
            MediumUrl: $"/avatars/{user.Id:N}/abc123/128.webp",
            LargeUrl: $"/avatars/{user.Id:N}/abc123/512.webp",
            ContentHash: "abc123");

        var fixture = CreateFixture(user.Id);
        fixture.Users.Setup(x => x.GetByIdAsync(user.Id, It.IsAny<CancellationToken>())).ReturnsAsync(user);
        fixture.Processor
            .Setup(x => x.ProcessAvatarAsync(It.IsAny<Stream>(), It.IsAny<long>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result<ProcessedAvatar>.Success(processed));
        fixture.AvatarStorage
            .Setup(x => x.PutAsync(user.Id, processed, It.IsAny<CancellationToken>()))
            .ReturnsAsync(manifest);
        fixture.UnitOfWork.Setup(x => x.SaveChangesAsync(It.IsAny<CancellationToken>())).ReturnsAsync(1);
        fixture.Mapper.Setup(x => x.Map<UserDto>(user))
            .Returns(new UserDto { Id = user.Id, Email = user.Email.Value, ProfilePictureUrl = manifest.CanonicalUrl });

        var result = await fixture.Handler.Handle(
            new UploadAvatarCommand { File = CreateFile(new byte[1]) },
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(manifest.MediumUrl, result.Value!.ProfilePictureUrl);
        Assert.Equal(manifest.MediumUrl, user.ProfilePictureUrl);
        fixture.AvatarStorage.Verify(x => x.PutAsync(user.Id, processed, It.IsAny<CancellationToken>()), Times.Once);
        fixture.UnitOfWork.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Once);
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

        var storage = new Mock<IAvatarStorage>();
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
        Mock<IAvatarStorage> AvatarStorage,
        Mock<IImageProcessor> Processor,
        Mock<IMapper> Mapper);
}
