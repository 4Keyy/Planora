using AutoMapper;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.EntityFrameworkCore.Storage;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Planora.Auth.Application.Common.Interfaces;
using Planora.Auth.Application.Features.Users.Commands.UploadAvatar;
using Planora.Auth.Application.Features.Users.Handlers.UploadAvatar;
using Planora.Auth.Domain.Entities;
using Planora.Auth.Infrastructure.Persistence;
using Planora.Auth.Infrastructure.Services.Common;
using Planora.BuildingBlocks.Application.Messaging;
using Planora.BuildingBlocks.Domain;
using AuthEmail = Planora.Auth.Domain.ValueObjects.Email;

namespace Planora.UnitTests.Services.AuthApi.Infrastructure;

public sealed class AvatarReplacementPersistenceTests
{
    [Fact]
    [Trait("TestType", "Regression")]
    public async Task UploadAvatar_SaveFailurePreservesBytesAtPersistedUrl()
    {
        var webRoot = Directory.CreateTempSubdirectory("planora-avatar-replacement-");
        try
        {
            var environment = new Mock<IWebHostEnvironment>();
            environment.SetupGet(x => x.WebRootPath).Returns(webRoot.FullName);
            var storage = new LocalAvatarStorage(environment.Object, NullLogger<LocalAvatarStorage>.Instance);
            var options = new DbContextOptionsBuilder<AuthDbContext>()
                .UseInMemoryDatabase("avatar-replacement", new InMemoryDatabaseRoot())
                .Options;
            var user = User.Create(AuthEmail.Create("avatar-owner@example.test"), "synthetic-hash", "Avatar", "Owner");
            var previous = await storage.PutAsync(user.Id, CreateAvatar("a1a1a1a1a1a1a1a1", 1));
            var previousPath = Path.Combine(webRoot.FullName, previous.CanonicalUrl.TrimStart('/'));
            var previousBytes = await File.ReadAllBytesAsync(previousPath);

            await using (var seed = CreateContext(options))
            {
                user.UpdateProfile(user.FirstName, user.LastName, previous.CanonicalUrl, user.Id);
                seed.Users.Add(user);
                await seed.SaveChangesAsync();
            }

            var replacement = CreateAvatar("b2b2b2b2b2b2b2b2", 2);
            var proposedUrl = $"/avatars/{user.Id:N}/{replacement.ContentHash}/128.webp";
            var failure = new DbUpdateException("Injected profile save failure");
            var writeOptions = new DbContextOptionsBuilder<AuthDbContext>(options)
                .AddInterceptors(new RejectProfileSave(proposedUrl, failure))
                .Options;
            using var unitOfWork = new AuthUnitOfWork(CreateContext(writeOptions));
            var currentUser = new Mock<ICurrentUserService>();
            currentUser.SetupGet(x => x.UserId).Returns(user.Id);
            var processor = new Mock<IImageProcessor>();
            processor.Setup(x => x.ProcessAvatarAsync(It.IsAny<Stream>(), It.IsAny<long>(), It.IsAny<CancellationToken>()))
                .ReturnsAsync(Result<ProcessedAvatar>.Success(replacement));
            var handler = new UploadAvatarCommandHandler(
                unitOfWork, currentUser.Object, storage, processor.Object,
                Mock.Of<IAvatarMetrics>(), Mock.Of<IMapper>(), NullLogger<UploadAvatarCommandHandler>.Instance);
            await using var payload = new MemoryStream(new byte[] { 2 });
            var upload = new UploadAvatarCommand { File = new FormFile(payload, 0, payload.Length, "file", "avatar.webp") };

            var exception = await Assert.ThrowsAsync<DbUpdateException>(() => handler.Handle(upload, CancellationToken.None));
            Assert.Same(failure, exception);

            await using var verify = CreateContext(options);
            var persisted = await verify.Users.AsNoTracking().SingleAsync(x => x.Id == user.Id);
            Assert.Equal(previous.CanonicalUrl, persisted.ProfilePictureUrl);
            Assert.True(File.Exists(previousPath), "The persisted profile URL must still resolve after a failed replacement.");
            Assert.Equal(previousBytes, await File.ReadAllBytesAsync(previousPath));
        }
        finally
        {
            webRoot.Delete(recursive: true);
        }
    }

    private static AuthDbContext CreateContext(DbContextOptions<AuthDbContext> options) =>
        new(options, Mock.Of<IDomainEventDispatcher>());

    private static ProcessedAvatar CreateAvatar(string hash, byte content) => new(
        hash,
        Enum.GetValues<AvatarSize>().Select(size =>
            new AvatarVariant(size, new[] { content }, "image/webp", ".webp", (int)size, (int)size)).ToArray());

    private sealed class RejectProfileSave(string proposedUrl, DbUpdateException failure) : SaveChangesInterceptor
    {
        public override ValueTask<InterceptionResult<int>> SavingChangesAsync(
            DbContextEventData eventData,
            InterceptionResult<int> result,
            CancellationToken cancellationToken = default)
        {
            var user = Assert.Single(eventData.Context!.ChangeTracker.Entries<User>()).Entity;
            Assert.Equal(proposedUrl, user.ProfilePictureUrl);
            throw failure;
        }
    }
}
