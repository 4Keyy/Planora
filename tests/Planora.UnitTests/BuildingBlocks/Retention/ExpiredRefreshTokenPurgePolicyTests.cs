using System.Reflection;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Planora.Auth.Domain.Entities;
using Planora.Auth.Infrastructure.Retention;
using Planora.BuildingBlocks.Infrastructure.Retention;

namespace Planora.UnitTests.BuildingBlocks.Retention;

/// <summary>
/// Eligibility coverage for <see cref="ExpiredRefreshTokenPurgePolicy"/> — proves it targets only tokens
/// expired longer ago than the grace window and spares recently-expired and still-valid tokens. Dry-run
/// against EF InMemory.
/// </summary>
public sealed class ExpiredRefreshTokenPurgePolicyTests
{
    private static readonly DateTime Now = new(2026, 07, 07, 03, 00, 00, DateTimeKind.Utc);

    private sealed class RefreshTokenTestDbContext : DbContext
    {
        public RefreshTokenTestDbContext(DbContextOptions options) : base(options) { }

        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            modelBuilder.Entity<RefreshToken>(b =>
            {
                b.Ignore("DomainEvents");
                b.Ignore(rt => rt.User);
                b.Ignore(rt => rt.IsExpired);
                b.Ignore(rt => rt.IsRevoked);
                b.Ignore(rt => rt.IsActive);
            });
        }
    }

    private sealed class AlwaysGrantLock : IRetentionLock
    {
        public Task<bool> TryAcquireAsync(DbContext db, long key, CancellationToken ct) => Task.FromResult(true);
        public Task ReleaseAsync(DbContext db, long key) => Task.CompletedTask;
    }

    private static RefreshToken Token(DateTime expiresAt)
    {
        // The constructor forbids a past expiry, so build valid then backdate ExpiresAt deterministically.
        var t = new RefreshToken(Guid.NewGuid(), Guid.NewGuid().ToString("N"), "127.0.0.1", DateTime.UtcNow.AddYears(1));
        typeof(RefreshToken).GetProperty(nameof(RefreshToken.ExpiresAt), BindingFlags.Public | BindingFlags.Instance)!
            .GetSetMethod(nonPublic: true)!
            .Invoke(t, new object?[] { expiresAt });
        return t;
    }

    [Fact]
    [Trait("TestType", "Unit")]
    public async Task Selects_OnlyTokensExpiredBeyondGraceWindow()
    {
        var options = new DbContextOptionsBuilder<RefreshTokenTestDbContext>()
            .UseInMemoryDatabase($"rt-token-{Guid.NewGuid():N}").Options;
        await using var db = new RefreshTokenTestDbContext(options);

        db.Add(Token(Now.AddDays(-40))); // expired 40d ago → eligible (grace 30)
        db.Add(Token(Now.AddDays(-10))); // expired 10d ago → within grace → kept
        db.Add(Token(Now.AddDays(30)));  // still valid → kept
        await db.SaveChangesAsync();

        var services = new ServiceCollection();
        services.AddSingleton<DbContext>(db);
        await using var provider = services.BuildServiceProvider();

        var policy = new ExpiredRefreshTokenPurgePolicy(new AlwaysGrantLock(), NullLogger<ExpiredRefreshTokenPurgePolicy>.Instance);
        var opts = new RetentionOptions { DryRun = true, PurgeExpiredRefreshTokens = true, ExpiredRefreshTokenDays = 30, MaxDeletionsPerRun = 1000 };

        var result = await policy.ExecuteAsync(provider, new RetentionContext(opts, Now), CancellationToken.None);

        Assert.Equal(1, result.Scanned);
        Assert.Equal(0, result.Deleted);
        Assert.Equal("expired-refresh-token-purge", result.PolicyName);
    }
}
