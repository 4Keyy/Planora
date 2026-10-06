using System.Reflection;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Planora.Auth.Domain.Entities;
using Planora.Auth.Infrastructure.Auditing;
using Planora.Auth.Infrastructure.Retention;
using Planora.BuildingBlocks.Domain;
using Planora.BuildingBlocks.Infrastructure.Retention;

namespace Planora.UnitTests.BuildingBlocks.Retention;

/// <summary>
/// Eligibility coverage for the opt-in security-forensics retention policies (login history 180d,
/// audit log 365d), plus proof they ship disabled by default. Dry-run against EF InMemory.
/// </summary>
public sealed class SecurityAuditRetentionPolicyTests
{
    private static readonly DateTime Now = new(2026, 07, 07, 03, 00, 00, DateTimeKind.Utc);

    private sealed class SecurityAuditTestDbContext : DbContext
    {
        public SecurityAuditTestDbContext(DbContextOptions options) : base(options) { }

        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            modelBuilder.Entity<LoginHistory>(b =>
            {
                b.Ignore("DomainEvents");
                b.Ignore(lh => lh.User);
            });
            modelBuilder.Entity<AuditLog>().Ignore("DomainEvents");
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

    private static LoginHistory Login(DateTime at)
    {
        var lh = new LoginHistory(Guid.NewGuid(), "1.2.3.4", "agent", true);
        SetPrivate(lh, typeof(LoginHistory), nameof(LoginHistory.LoginAt), at);
        return lh;
    }

    private static AuditLog Audit(DateTime createdAt)
    {
        var a = AuditLog.CreateEventLog("login", "details", Guid.NewGuid());
        SetPrivate(a, typeof(BaseEntity), nameof(BaseEntity.CreatedAt), createdAt);
        return a;
    }

    private static SecurityAuditTestDbContext NewDb() =>
        new(new DbContextOptionsBuilder<SecurityAuditTestDbContext>()
            .UseInMemoryDatabase($"sec-{Guid.NewGuid():N}").Options);

    private static async Task<RetentionResult> RunAsync(IRetentionPolicy policy, DbContext db, RetentionOptions options)
    {
        var services = new ServiceCollection();
        services.AddSingleton<DbContext>(db);
        await using var provider = services.BuildServiceProvider();
        return await policy.ExecuteAsync(provider, new RetentionContext(options, Now), CancellationToken.None);
    }

    [Fact]
    [Trait("TestType", "Unit")]
    public async Task LoginHistory_SelectsOnlyRowsOlderThanWindow()
    {
        await using var db = NewDb();
        db.Add(Login(Now.AddDays(-200))); // eligible (window 180)
        db.Add(Login(Now.AddDays(-181))); // eligible
        db.Add(Login(Now.AddDays(-30)));  // recent → kept
        await db.SaveChangesAsync();

        var policy = new LoginHistoryPurgePolicy(new AlwaysGrantLock(), NullLogger<LoginHistoryPurgePolicy>.Instance);
        var result = await RunAsync(policy, db, new RetentionOptions { DryRun = true, PurgeLoginHistory = true, LoginHistoryDays = 180, MaxDeletionsPerRun = 1000 });

        Assert.Equal(2, result.Scanned);
    }

    [Fact]
    [Trait("TestType", "Unit")]
    public async Task AuditLog_SelectsOnlyRowsOlderThanWindow()
    {
        await using var db = NewDb();
        db.Add(Audit(Now.AddDays(-400))); // eligible (window 365)
        db.Add(Audit(Now.AddDays(-100))); // recent → kept
        await db.SaveChangesAsync();

        var policy = new AuditLogPurgePolicy(new AlwaysGrantLock(), NullLogger<AuditLogPurgePolicy>.Instance);
        var result = await RunAsync(policy, db, new RetentionOptions { DryRun = true, PurgeAuditLogs = true, AuditLogDays = 365, MaxDeletionsPerRun = 1000 });

        Assert.Equal(1, result.Scanned);
    }

    [Fact]
    [Trait("TestType", "Unit")]
    public void BothPolicies_ShipDisabledByDefault()
    {
        var defaults = new RetentionOptions();
        var login = new LoginHistoryPurgePolicy(new AlwaysGrantLock(), NullLogger<LoginHistoryPurgePolicy>.Instance);
        var audit = new AuditLogPurgePolicy(new AlwaysGrantLock(), NullLogger<AuditLogPurgePolicy>.Instance);

        Assert.False(login.IsEnabled(defaults));
        Assert.False(audit.IsEnabled(defaults));
    }
}
