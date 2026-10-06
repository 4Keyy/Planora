using System.Reflection;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Planora.BuildingBlocks.Domain;
using Planora.BuildingBlocks.Infrastructure.Retention;
using Planora.BuildingBlocks.Infrastructure.Retention.Policies;

namespace Planora.UnitTests.BuildingBlocks.Retention;

/// <summary>
/// Eligibility coverage for <see cref="SoftDeletedPurgePolicy{TEntity}"/> — proves it targets exactly the
/// rows soft-deleted before the grace cutoff and spares rows still inside the recovery window and rows that
/// are not deleted at all. Uses a minimal <see cref="BaseEntity"/>-derived test entity so it exercises the
/// shared soft-delete fields directly, in dry-run against EF InMemory.
/// </summary>
public sealed class SoftDeletedPurgePolicyTests
{
    private static readonly DateTime Now = new(2026, 07, 07, 03, 00, 00, DateTimeKind.Utc);

    private sealed class Widget : BaseEntity
    {
        public Widget() : base() { }
    }

    private sealed class WidgetDbContext : DbContext
    {
        public WidgetDbContext(DbContextOptions options) : base(options) { }

        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            modelBuilder.Entity<Widget>().Ignore("DomainEvents");
        }
    }

    private sealed class AlwaysGrantLock : IRetentionLock
    {
        public Task<bool> TryAcquireAsync(DbContext db, long key, CancellationToken ct) => Task.FromResult(true);
        public Task ReleaseAsync(DbContext db, long key) => Task.CompletedTask;
    }

    private static Widget SoftDeleted(DateTime deletedAt)
    {
        var w = new Widget();
        w.MarkAsDeleted(Guid.NewGuid());
        typeof(BaseEntity).GetProperty(nameof(BaseEntity.DeletedAt), BindingFlags.Public | BindingFlags.Instance)!
            .GetSetMethod(nonPublic: true)!
            .Invoke(w, new object?[] { deletedAt });
        return w;
    }

    [Fact]
    [Trait("TestType", "Unit")]
    public async Task Selects_OnlyRowsSoftDeletedBeforeGraceCutoff()
    {
        var options = new DbContextOptionsBuilder<WidgetDbContext>()
            .UseInMemoryDatabase($"soft-{Guid.NewGuid():N}").Options;
        await using var db = new WidgetDbContext(options);

        db.Add(SoftDeleted(Now.AddDays(-10))); // past grace → eligible
        db.Add(SoftDeleted(Now.AddDays(-8)));  // past grace → eligible
        db.Add(SoftDeleted(Now.AddDays(-3)));  // within grace → kept
        db.Add(new Widget());                  // live → kept
        await db.SaveChangesAsync();

        var services = new ServiceCollection();
        services.AddSingleton<DbContext>(db);
        await using var provider = services.BuildServiceProvider();

        var policy = new SoftDeletedPurgePolicy<Widget>(
            new AlwaysGrantLock(), NullLogger<SoftDeletedPurgePolicy<Widget>>.Instance);

        var opts = new RetentionOptions { DryRun = true, PurgeSoftDeleted = true, SoftDeleteGraceDays = 7, MaxDeletionsPerRun = 1000 };
        var result = await policy.ExecuteAsync(provider, new RetentionContext(opts, Now), CancellationToken.None);

        Assert.True(result.DryRun);
        Assert.Equal(0, result.Deleted);
        Assert.Equal(2, result.Scanned);
        Assert.Equal("soft-delete-purge:Widget", result.PolicyName);
    }

    [Fact]
    [Trait("TestType", "Unit")]
    public void IsEnabled_FollowsPurgeSoftDeletedFlag()
    {
        var policy = new SoftDeletedPurgePolicy<Widget>(
            new AlwaysGrantLock(), NullLogger<SoftDeletedPurgePolicy<Widget>>.Instance);

        Assert.True(policy.IsEnabled(new RetentionOptions { PurgeSoftDeleted = true }));
        Assert.False(policy.IsEnabled(new RetentionOptions { PurgeSoftDeleted = false }));
    }
}
