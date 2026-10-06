using System.Reflection;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Planora.Auth.Application.Common.Interfaces;
using Planora.Auth.Application.Features.Users.Commands.DeleteUser;
using Planora.Auth.Application.Features.Users.Handlers.DeleteUser;
using Planora.Auth.Domain.Entities;
using Planora.Auth.Domain.Repositories;
using Planora.Auth.Domain.ValueObjects;
using Planora.Auth.Infrastructure;
using Planora.Auth.Infrastructure.Persistence;
using Planora.BuildingBlocks.Application.Messaging;
using Planora.BuildingBlocks.Application.Messaging.Events;
using Planora.BuildingBlocks.Application.Outbox;
using Planora.BuildingBlocks.Infrastructure.Outbox;
using Planora.UnitTests.BuildingBlocks.Retention.Postgres;

namespace Planora.UnitTests.Services.AuthApi.Infrastructure;

[Trait("TestType", "Integration")]
[Trait("TestType", "Security")]
public sealed class AuthDeletionOutboxTests
{
    [Fact]
    public void AuthInfrastructure_RegistersCanonicalOutboxWithScopedContextAndImmediateDispatch()
    {
        var services = new ServiceCollection();
        services.AddAuthInfrastructure(Configuration("Host=localhost;Database=unused;Username=postgres;Password=postgres"));

        Assert.Contains(services, descriptor => descriptor.ServiceType == typeof(IOutboxRepository)
            && descriptor.ImplementationType == typeof(Planora.BuildingBlocks.Infrastructure.Persistence.OutboxRepository<AuthDbContext>)
            && descriptor.Lifetime == ServiceLifetime.Scoped);
        Assert.Contains(services, descriptor => descriptor.ServiceType == typeof(OutboxSignal)
            && descriptor.Lifetime == ServiceLifetime.Singleton);
        Assert.Contains(services, descriptor => descriptor.ServiceType == typeof(OutboxNotifyInterceptor)
            && descriptor.Lifetime == ServiceLifetime.Scoped);
        Assert.Contains(services, descriptor => descriptor.ServiceType == typeof(IHostedService)
            && descriptor.ImplementationType == typeof(OutboxProcessor));
    }

    [PostgresFact]
    public async Task DeletionAndCleanupEvent_CommitTogether_AndSurviveSecurityStampFailure()
    {
        await using var fixture = await Fixture.CreateAsync();
        fixture.SecurityStamp.Setup(x => x.SetStampAsync(fixture.UserId, It.IsAny<CancellationToken>()))
            .ThrowsAsync(new IOException("Redis unavailable"));

        await using (var scope = fixture.Services.CreateAsyncScope())
        {
            var context = scope.ServiceProvider.GetRequiredService<AuthDbContext>();
            Assert.Same(context, scope.ServiceProvider.GetRequiredService<DbContext>());
            var options = scope.ServiceProvider.GetRequiredService<DbContextOptions<AuthDbContext>>();
            Assert.Contains(options.FindExtension<CoreOptionsExtension>()!.Interceptors!, interceptor => interceptor is OutboxNotifyInterceptor);
            await Assert.ThrowsAsync<IOException>(() => fixture.Handler(scope.ServiceProvider).Handle(
                new DeleteUserCommand { Password = "valid-test-password" }, CancellationToken.None));
        }

        await using var verification = fixture.Services.CreateAsyncScope();
        var saved = verification.ServiceProvider.GetRequiredService<AuthDbContext>();
        var user = await saved.Users.IgnoreQueryFilters().SingleAsync(x => x.Id == fixture.UserId);
        Assert.True(user.IsDeleted);
        Assert.False(user.IsActive);
        var message = await saved.OutboxMessages.SingleAsync();
        Assert.Equal(OutboxMessageStatus.Pending, message.Status);
        Assert.Equal(typeof(UserDeletedIntegrationEvent).AssemblyQualifiedName, message.Type);
        var cleanupEvent = JsonSerializer.Deserialize<UserDeletedIntegrationEvent>(message.Content)!;
        Assert.Equal(fixture.UserId, cleanupEvent.UserId);
        Assert.Equal(user.Email.Value, cleanupEvent.Email);
        fixture.Avatars.Verify(x => x.DeleteAsync(fixture.UserId, It.IsAny<CancellationToken>()), Times.Once);
        fixture.EventBus.Verify(x => x.PublishAsync(It.IsAny<UserDeletedIntegrationEvent>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [PostgresFact]
    public async Task BrokerFailure_DoesNotFailDeletion_AndProcessorRetriesPersistedCleanupEvent()
    {
        await using var fixture = await Fixture.CreateAsync();
        fixture.EventBus.Setup(x => x.PublishAsync(It.IsAny<UserDeletedIntegrationEvent>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new IOException("Broker unavailable"));

        await using (var scope = fixture.Services.CreateAsyncScope())
        {
            var result = await fixture.Handler(scope.ServiceProvider).Handle(
                new DeleteUserCommand { Password = "valid-test-password" }, CancellationToken.None);
            Assert.True(result.IsSuccess);
        }

        fixture.EventBus.Verify(x => x.PublishAsync(It.IsAny<UserDeletedIntegrationEvent>(), It.IsAny<CancellationToken>()), Times.Never);
        await ProcessOnePassAsync(fixture.Services);

        Guid messageId;
        Guid eventId;
        await using (var verification = fixture.Services.CreateAsyncScope())
        {
            var context = verification.ServiceProvider.GetRequiredService<AuthDbContext>();
            var message = await context.OutboxMessages.SingleAsync();
            messageId = message.Id;
            eventId = JsonSerializer.Deserialize<UserDeletedIntegrationEvent>(message.Content)!.Id;
            Assert.Equal(OutboxMessageStatus.Pending, message.Status);
            Assert.Equal(1, message.RetryCount);
            Assert.NotNull(message.NextRetryUtc);
            Assert.Null(message.ProcessedOnUtc);
            Assert.True(await context.Users.IgnoreQueryFilters().Where(x => x.Id == fixture.UserId).Select(x => x.IsDeleted).SingleAsync());
        }

        fixture.EventBus.Setup(x => x.PublishAsync(It.IsAny<UserDeletedIntegrationEvent>(), It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);
        await ProcessOnePassAsync(fixture.Services);
        fixture.EventBus.Verify(x => x.PublishAsync(It.IsAny<UserDeletedIntegrationEvent>(), It.IsAny<CancellationToken>()), Times.Once);

        await using (var retryDue = fixture.Services.CreateAsyncScope())
        {
            var context = retryDue.ServiceProvider.GetRequiredService<AuthDbContext>();
            var message = await context.OutboxMessages.SingleAsync();
            context.Entry(message).Property(nameof(OutboxMessage.NextRetryUtc)).CurrentValue = DateTime.UtcNow.AddSeconds(-1);
            await context.SaveChangesAsync();
        }
        await ProcessOnePassAsync(fixture.Services);

        await using var finalVerification = fixture.Services.CreateAsyncScope();
        var delivered = await finalVerification.ServiceProvider.GetRequiredService<AuthDbContext>().OutboxMessages.SingleAsync();
        Assert.Equal(messageId, delivered.Id);
        Assert.Equal(OutboxMessageStatus.Processed, delivered.Status);
        Assert.NotNull(delivered.ProcessedOnUtc);
        fixture.EventBus.Verify(x => x.PublishAsync(
            It.Is<UserDeletedIntegrationEvent>(e => e.Id == eventId && e.UserId == fixture.UserId),
            It.IsAny<CancellationToken>()), Times.Exactly(2));
    }

    [PostgresFact]
    public async Task RejectedOutboxInsert_RollsBackDeletion_WithoutExternalSideEffects()
    {
        await using var fixture = await Fixture.CreateAsync();
        await using (var scope = fixture.Services.CreateAsyncScope())
        {
            var context = scope.ServiceProvider.GetRequiredService<AuthDbContext>();
            await context.Database.ExecuteSqlRawAsync("""
                ALTER TABLE "OutboxMessages" ADD CONSTRAINT reject_cleanup
                CHECK ("Type" NOT LIKE '%UserDeletedIntegrationEvent%')
                """);

            await Assert.ThrowsAsync<DbUpdateException>(() => fixture.Handler(scope.ServiceProvider).Handle(
                new DeleteUserCommand { Password = "valid-test-password" }, CancellationToken.None));
        }

        await using var verification = fixture.Services.CreateAsyncScope();
        var saved = verification.ServiceProvider.GetRequiredService<AuthDbContext>();
        var user = await saved.Users.SingleAsync(x => x.Id == fixture.UserId);
        Assert.False(user.IsDeleted);
        Assert.True(user.IsActive);
        Assert.Empty(await saved.OutboxMessages.ToListAsync());
        fixture.SecurityStamp.Verify(x => x.SetStampAsync(It.IsAny<Guid>(), It.IsAny<CancellationToken>()), Times.Never);
        fixture.Avatars.Verify(x => x.DeleteAsync(It.IsAny<Guid>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    private static IConfiguration Configuration(string connectionString) => new ConfigurationBuilder()
        .AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["ConnectionStrings:AuthDatabase"] = connectionString,
            ["ConnectionStrings:Redis"] = "127.0.0.1:1,abortConnect=false,connectTimeout=1,syncTimeout=1,connectRetry=0",
            ["JwtSettings:Secret"] = new string('x', 48),
            ["JwtSettings:Issuer"] = "Planora.Test",
            ["JwtSettings:Audience"] = "Planora.Test",
            ["IsDevelopment"] = "true",
        }).Build();

    // Exercise one deterministic pass of the production processor without starting RabbitMQ's
    // separate hosted connection manager or waiting for its five-second background polling loop.
    private static async Task ProcessOnePassAsync(IServiceProvider services)
    {
        var processor = new OutboxProcessor(services, NullLogger<OutboxProcessor>.Instance);
        var method = typeof(OutboxProcessor).GetMethod("ProcessOutboxMessagesAsync", BindingFlags.Instance | BindingFlags.NonPublic)!;
        await (Task<int>)method.Invoke(processor, [CancellationToken.None])!;
        processor.Dispose();
    }

    private sealed class Fixture : IAsyncDisposable
    {
        private readonly TemporaryDatabase _database;
        public ServiceProvider Services { get; }
        public Guid UserId { get; }
        public Mock<ISecurityStampService> SecurityStamp { get; } = new();
        public Mock<IAvatarStorage> Avatars { get; } = new();
        public Mock<IEventBus> EventBus { get; } = new();

        private Fixture(TemporaryDatabase database, User user)
        {
            _database = database;
            UserId = user.Id;
            var configuration = Configuration(database.ConnectionString);
            var services = new ServiceCollection();
            services.AddLogging();
            services.AddSingleton(configuration);
            services.AddSingleton(Mock.Of<IDomainEventDispatcher>());
            services.AddAuthInfrastructure(configuration);
            services.AddSingleton(SecurityStamp.Object);
            services.AddSingleton(Avatars.Object);
            services.AddSingleton(EventBus.Object);
            services.AddSingleton(Mock.Of<ICurrentUserService>(x => x.UserId == user.Id));
            services.AddSingleton(Mock.Of<IPasswordHasher>(x => x.VerifyPassword("valid-test-password", user.PasswordHash) == true));
            Services = services.BuildServiceProvider(validateScopes: true);
        }

        public static async Task<Fixture> CreateAsync()
        {
            var database = await TemporaryDatabase.CreateAsync();
            var user = User.Create(Email.Create($"outbox-{Guid.NewGuid():N}@example.test"), "test-hash", "Outbox", "Test");
            user.VerifyEmail();
            user.ClearDomainEvents();
            var fixture = new Fixture(database, user);
            await using var scope = fixture.Services.CreateAsyncScope();
            var context = scope.ServiceProvider.GetRequiredService<AuthDbContext>();
            await context.Database.EnsureCreatedAsync();
            context.Users.Add(user);
            await context.SaveChangesAsync();
            return fixture;
        }

        public DeleteUserCommandHandler Handler(IServiceProvider services) => new(
            services.GetRequiredService<IAuthUnitOfWork>(),
            services.GetRequiredService<IPasswordHasher>(),
            services.GetRequiredService<ICurrentUserService>(),
            services.GetRequiredService<IOutboxRepository>(),
            SecurityStamp.Object,
            Avatars.Object,
            NullLogger<DeleteUserCommandHandler>.Instance);

        public async ValueTask DisposeAsync()
        {
            await Services.DisposeAsync();
            await _database.DisposeAsync();
        }
    }
}
