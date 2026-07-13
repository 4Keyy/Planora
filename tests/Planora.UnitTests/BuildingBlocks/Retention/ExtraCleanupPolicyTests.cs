using System.Reflection;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Planora.Auth.Domain.Entities;
using Planora.Auth.Infrastructure.Retention;
using Planora.BuildingBlocks.Domain;
using Planora.BuildingBlocks.Infrastructure.Retention;
using Planora.Messaging.Domain.Entities;
using Planora.Messaging.Infrastructure.Retention;

namespace Planora.UnitTests.BuildingBlocks.Retention;

/// <summary>
/// Eligibility coverage for the "last-mile" cleanup vectors that complete 100% coverage: terminal
/// friendship rows, spent recovery codes, and (opt-in) old messages. Dry-run against EF InMemory.
/// </summary>
public sealed class ExtraCleanupPolicyTests
{
    private static readonly DateTime Now = new(2026, 07, 08, 03, 00, 00, DateTimeKind.Utc);

    private sealed class ExtraTestDbContext : DbContext
    {
        public ExtraTestDbContext(DbContextOptions options) : base(options) { }

        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            modelBuilder.Entity<Friendship>(b =>
            {
                b.Ignore("DomainEvents");
                b.Ignore(f => f.Requester);
                b.Ignore(f => f.Addressee);
            });
            modelBuilder.Entity<UserRecoveryCode>().Ignore("DomainEvents");
            modelBuilder.Entity<Message>().Ignore("DomainEvents");
        }
    }

    private sealed class AlwaysGrantLock : IRetentionLock
    {
        public Task<bool> TryAcquireAsync(DbContext db, long key, CancellationToken ct) => Task.FromResult(true);
        public Task ReleaseAsync(DbContext db, long key) => Task.CompletedTask;
    }

    private static void SetPrivate(object target, Type declaring, string property, object? value) =>
        declaring.GetProperty(property, BindingFlags.Public | BindingFlags.Instance)!
            .GetSetMethod(nonPublic: true)!.Invoke(target, new[] { value });

    private static ExtraTestDbContext NewDb() =>
        new(new DbContextOptionsBuilder<ExtraTestDbContext>().UseInMemoryDatabase($"extra-{Guid.NewGuid():N}").Options);

    private static async Task<RetentionResult> RunAsync(IRetentionPolicy policy, DbContext db, RetentionOptions options)
    {
        var services = new ServiceCollection();
        services.AddSingleton<DbContext>(db);
        await using var provider = services.BuildServiceProvider();
        return await policy.ExecuteAsync(provider, new RetentionContext(options, Now), CancellationToken.None);
    }

    private static Friendship Rejected(DateTime at)
    {
        var requester = Guid.NewGuid();
        var addressee = Guid.NewGuid();
        var f = Friendship.Create(requester, addressee);
        f.Reject(addressee);
        SetPrivate(f, typeof(BaseEntity), nameof(BaseEntity.UpdatedAt), at);
        return f;
    }

    [Fact]
    [Trait("TestType", "Unit")]
    public async Task Friendship_SelectsOnlyOldTerminalRows()
    {
        await using var db = NewDb();
        db.Add(Rejected(Now.AddDays(-100)));                 // eligible (window 90)
        db.Add(Rejected(Now.AddDays(-10)));                  // recent → kept
        db.Add(Friendship.Create(Guid.NewGuid(), Guid.NewGuid())); // pending → kept

        var accepted = Friendship.Create(Guid.NewGuid(), Guid.NewGuid());
        var addressee = accepted.AddresseeId;
        accepted.Accept(addressee);
        SetPrivate(accepted, typeof(BaseEntity), nameof(BaseEntity.UpdatedAt), Now.AddDays(-100));
        db.Add(accepted);                                    // active friendship → kept
        await db.SaveChangesAsync();

        var policy = new FriendshipTerminalPurgePolicy(new AlwaysGrantLock(), NullLogger<FriendshipTerminalPurgePolicy>.Instance);
        var result = await RunAsync(policy, db, new RetentionOptions { DryRun = true, FriendshipTerminalDays = 90, MaxDeletionsPerRun = 1000 });

        Assert.Equal(1, result.Scanned);
    }

    [Fact]
    [Trait("TestType", "Unit")]
    public async Task RecoveryCode_SelectsOnlyOldUsedCodes()
    {
        await using var db = NewDb();

        var usedOld = new UserRecoveryCode(Guid.NewGuid(), "hash1");
        usedOld.MarkAsUsed();
        SetPrivate(usedOld, typeof(UserRecoveryCode), nameof(UserRecoveryCode.UsedAt), Now.AddDays(-40));
        db.Add(usedOld);                                     // eligible (window 30)

        var usedRecent = new UserRecoveryCode(Guid.NewGuid(), "hash2");
        usedRecent.MarkAsUsed();
        SetPrivate(usedRecent, typeof(UserRecoveryCode), nameof(UserRecoveryCode.UsedAt), Now.AddDays(-5));
        db.Add(usedRecent);                                  // recent → kept

        db.Add(new UserRecoveryCode(Guid.NewGuid(), "hash3")); // unused → kept
        await db.SaveChangesAsync();

        var policy = new UsedRecoveryCodePurgePolicy(new AlwaysGrantLock(), NullLogger<UsedRecoveryCodePurgePolicy>.Instance);
        var result = await RunAsync(policy, db, new RetentionOptions { DryRun = true, RecoveryCodeUsedDays = 30, MaxDeletionsPerRun = 1000 });

        Assert.Equal(1, result.Scanned);
    }

    [Fact]
    [Trait("TestType", "Unit")]
    public async Task Message_SelectsOnlyOldMessages()
    {
        await using var db = NewDb();

        var old = new Message("s", "b", Guid.NewGuid(), Guid.NewGuid());
        SetPrivate(old, typeof(BaseEntity), nameof(BaseEntity.CreatedAt), Now.AddDays(-400));
        db.Add(old);                                         // eligible (window 365)
        db.Add(new Message("s", "b", Guid.NewGuid(), Guid.NewGuid())); // recent → kept
        await db.SaveChangesAsync();

        var policy = new MessageRetentionPurgePolicy(new AlwaysGrantLock(), NullLogger<MessageRetentionPurgePolicy>.Instance);
        var result = await RunAsync(policy, db, new RetentionOptions { DryRun = true, MessageDays = 365, MaxDeletionsPerRun = 1000 });

        Assert.Equal(1, result.Scanned);
    }

    [Fact]
    [Trait("TestType", "Unit")]
    public void Defaults_KeepUserContentOptInAndRecoveryCodesOn()
    {
        var d = new RetentionOptions();
        Assert.True(d.PurgeUsedRecoveryCodes);   // safe housekeeping → on
        Assert.False(d.PurgeFriendships);        // user-meaningful → opt-in
        Assert.False(d.PurgeMessages);           // user content → opt-in
    }
}
