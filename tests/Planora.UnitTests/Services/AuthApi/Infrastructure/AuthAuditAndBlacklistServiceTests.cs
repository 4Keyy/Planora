using Planora.Auth.Infrastructure.Persistence;
using Planora.Auth.Infrastructure.Services.Common;
using Planora.Auth.Infrastructure.Services.Security;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Distributed;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Moq;
using AuthEventDispatcher = Planora.BuildingBlocks.Infrastructure.Messaging.IDomainEventDispatcher;

namespace Planora.UnitTests.Services.AuthApi.Infrastructure;

public sealed class AuthAuditAndBlacklistServiceTests
{
    [Fact]
    [Trait("TestType", "Integration")]
    [Trait("TestType", "Regression")]
    public async Task AuditService_ShouldPersistAuditLogsWithExpectedSeverity()
    {
        using var context = CreateContext();
        var service = new AuditService(context, Mock.Of<ILogger<AuditService>>());
        var userId = Guid.NewGuid();

        await service.LogAuditEventAsync(userId, "DELETE_ACCOUNT", "deleted", "127.0.0.1");
        await service.LogAuditEventAsync(userId, "FAILED_LOGIN", "failed", "127.0.0.1");
        await service.LogAuditEventAsync(userId, "PROFILE_UPDATED", "updated", "127.0.0.1");

        var logs = context.AuditLogs.OrderBy(log => log.CreatedAt).ToList();
        Assert.Equal(3, logs.Count);
        Assert.Equal("Critical", logs[0].Severity);
        Assert.Equal("Warning", logs[1].Severity);
        Assert.Equal("Info", logs[2].Severity);
        Assert.All(logs, log =>
        {
            Assert.Equal(userId, log.EntityId);
            Assert.Equal("User", log.EntityName);
            Assert.Equal("127.0.0.1", log.IpAddress);
        });
    }

    [Fact]
    [Trait("TestType", "Resilience")]
    [Trait("TestType", "Regression")]
    public async Task AuditService_ShouldSwallowPersistenceErrorsAfterLogging()
    {
        var context = CreateContext();
        var service = new AuditService(context, Mock.Of<ILogger<AuditService>>());
        await context.DisposeAsync();

        await service.LogAuditEventAsync(Guid.NewGuid(), "DELETE_ACCOUNT", "disposed context");
    }

    [Fact]
    [Trait("TestType", "Integration")]
    [Trait("TestType", "Security")]
    [Trait("TestType", "Regression")]
    public async Task TokenBlacklistService_ShouldUseCacheTtlAndAdapters()
    {
        var cache = new MemoryDistributedCache(Options.Create(new MemoryDistributedCacheOptions()));
        var service = new TokenBlacklistService(cache, Mock.Of<ILogger<TokenBlacklistService>>());

        await service.AddToBlacklistAsync("future-token", DateTime.UtcNow.AddMinutes(5));
        await service.AddToBlacklistAsync("expired-token", DateTime.UtcNow.AddMinutes(-5));
        await service.BlacklistTokenAsync("adapter-token", TimeSpan.FromMinutes(5));
        await service.CleanupExpiredTokensAsync();
        await service.RemoveExpiredTokensAsync();

        Assert.True(await service.IsTokenBlacklistedAsync("future-token"));
        Assert.True(await service.IsTokenBlacklistedAsync("adapter-token"));
        Assert.False(await service.IsTokenBlacklistedAsync("expired-token"));
        Assert.False(await service.IsTokenBlacklistedAsync("missing-token"));
    }

    [Fact]
    [Trait("TestType", "Resilience")]
    [Trait("TestType", "Regression")]
    public async Task TokenBlacklistService_ShouldRethrowSetFailuresAndFailClosedOnReadFailures()
    {
        var cache = new Mock<IDistributedCache>();
        cache
            .Setup(x => x.SetAsync(
                It.IsAny<string>(),
                It.IsAny<byte[]>(),
                It.IsAny<DistributedCacheEntryOptions>(),
                It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("cache set failed"));
        cache
            .Setup(x => x.GetAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("cache get failed"));
        var service = new TokenBlacklistService(cache.Object, Mock.Of<ILogger<TokenBlacklistService>>());

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            service.AddToBlacklistAsync("token", DateTime.UtcNow.AddMinutes(5)));
        Assert.False(await service.IsTokenBlacklistedAsync("token"));
    }

    private static AuthDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<AuthDbContext>()
            .UseInMemoryDatabase($"auth-audit-{Guid.NewGuid():N}")
            .Options;

        return new AuthDbContext(options, Mock.Of<AuthEventDispatcher>());
    }
}
