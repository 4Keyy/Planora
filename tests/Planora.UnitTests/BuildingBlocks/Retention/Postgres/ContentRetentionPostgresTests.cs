using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Planora.BuildingBlocks.Application.Messaging;
using Planora.BuildingBlocks.Application.Outbox;
using Planora.BuildingBlocks.Infrastructure.Inbox;
using Planora.BuildingBlocks.Infrastructure.Retention;
using Planora.BuildingBlocks.Infrastructure.Retention.Policies;
using Planora.Category.Infrastructure.Persistence;
using Planora.Collaboration.Domain.Entities;
using Planora.Collaboration.Infrastructure.Persistence;
using Planora.Messaging.Domain.Entities;
using Planora.Messaging.Infrastructure.Persistence;
using Planora.Messaging.Infrastructure.Retention;
using static Planora.UnitTests.BuildingBlocks.Retention.Postgres.RetentionTestKit;
using CategoryEntity = Planora.Category.Domain.Entities.Category;

namespace Planora.UnitTests.BuildingBlocks.Retention.Postgres;

/// <summary>
/// The content services' retention, live on PostgreSQL: soft-deleted categories and comments are purged
/// past the grace window, Collaboration's and Messaging's spent inbox/outbox rows go, and the opt-in
/// message purge deletes exactly its window. Plus the advisory lock itself, which is what keeps two
/// replicas from purging at once.
/// </summary>
[Trait("TestType", "Integration")]
public sealed class ContentRetentionPostgresTests
{
    private static readonly Guid Owner = Guid.NewGuid();

    private static async Task<(TemporaryDatabase Database, ServiceProvider Services)> CreateAsync<TContext>(Func<DbContextOptions<TContext>, TContext> create)
        where TContext : DbContext
    {
        var database = await TemporaryDatabase.CreateAsync();
        var services = new ServiceCollection();
        services.AddScoped(_ => create(database.Options<TContext>()));
        services.AddScoped<DbContext>(sp => sp.GetRequiredService<TContext>());
        var provider = services.BuildServiceProvider();

        await using var scope = provider.CreateAsyncScope();
        await scope.ServiceProvider.GetRequiredService<TContext>().Database.EnsureCreatedAsync();
        return (database, provider);
    }

    [PostgresFact]
    public async Task SoftDeletedCategories_ArePurgedPastGrace()
    {
        var (database, provider) = await CreateAsync<CategoryDbContext>(o => new CategoryDbContext(o, Mock.Of<IDomainEventDispatcher>()));
        await using var _ = database;
        await using var __ = provider;
        var now = DateTime.UtcNow;

        await using (var scope = provider.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<CategoryDbContext>();
            CategoryEntity Deleted(string name, DateTime at)
            {
                var category = CategoryEntity.Create(Owner, name, null, "#007BFF", null, 0);
                category.MarkAsDeleted(Owner);
                Set(category, nameof(CategoryEntity.DeletedAt), at);
                return category;
            }

            db.Categories.AddRange(
                Deleted("gone a", now.AddDays(-30)), Deleted("gone b", now.AddDays(-9)), Deleted("gone c", now.AddDays(-8)),
                Deleted("deleted today", now),
                CategoryEntity.Create(Owner, "live", null, "#007BFF", null, 1));
            await db.SaveChangesAsync();
        }

        await using (var scope = provider.CreateAsyncScope())
        {
            var result = await RunAsync(new SoftDeletedPurgePolicy<CategoryEntity>(new PostgresRetentionLock(), NullLogger<SoftDeletedPurgePolicy<CategoryEntity>>.Instance), scope.ServiceProvider, Live(), now);
            Assert.Equal(3, result.Deleted);
        }

        await using (var scope = provider.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<CategoryDbContext>();
            var names = await db.Categories.IgnoreQueryFilters().Select(c => c.Name).ToListAsync();
            Assert.Equal(new[] { "deleted today", "live" }.Order(), names.Order());
        }
    }

    [PostgresFact]
    public async Task SoftDeletedComments_ArePurgedPastGrace_AndSpentInboxRowsGo()
    {
        var (database, provider) = await CreateAsync<CollaborationDbContext>(o => new CollaborationDbContext(o));
        await using var _ = database;
        await using var __ = provider;
        var now = DateTime.UtcNow;
        var task = Guid.NewGuid();

        await using (var scope = provider.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<CollaborationDbContext>();
            var old = Comment.Create(task, Owner, "Ada", "deleted a while ago");
            old.MarkAsDeleted(Owner);
            Set(old, nameof(Comment.DeletedAt), now.AddDays(-12));
            var recent = Comment.Create(task, Owner, "Ada", "deleted today");
            recent.MarkAsDeleted(Owner);
            db.Comments.AddRange(old, recent, Comment.Create(task, Owner, "Ada", "live"));

            var spent = new InboxMessage(Guid.NewGuid(), "Evt", "{}", now.AddDays(-10));
            spent.MarkAsProcessed();
            Set(spent, nameof(InboxMessage.ProcessedOn), now.AddDays(-10));
            db.InboxMessages.AddRange(spent, new InboxMessage(Guid.NewGuid(), "Evt", "{}", now));
            await db.SaveChangesAsync();
        }

        await using (var scope = provider.CreateAsyncScope())
        {
            var comments = await RunAsync(new SoftDeletedPurgePolicy<Comment>(new PostgresRetentionLock(), NullLogger<SoftDeletedPurgePolicy<Comment>>.Instance), scope.ServiceProvider, Live(), now);
            var messages = await RunAsync(new ProcessedMessagePurgePolicy(new PostgresRetentionLock(), NullLogger<ProcessedMessagePurgePolicy>.Instance), scope.ServiceProvider, Live(), now);
            Assert.Equal(1, comments.Deleted);
            Assert.Equal(1, messages.Deleted);
        }

        await using (var scope = provider.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<CollaborationDbContext>();
            Assert.Equal(2, await db.Comments.IgnoreQueryFilters().CountAsync());
            Assert.Equal(1, await db.InboxMessages.CountAsync());
        }
    }

    [PostgresFact]
    public async Task MessagePurge_WhenSwitchedOn_DeletesOnlyMessagesPastItsWindow()
    {
        var (database, provider) = await CreateAsync<MessagingDbContext>(o => new MessagingDbContext(o));
        await using var _ = database;
        await using var __ = provider;
        var now = DateTime.UtcNow;

        await using (var scope = provider.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<MessagingDbContext>();
            var old = new Message("hello", "a year and a half ago", Owner, Guid.NewGuid());
            Set(old, nameof(Message.CreatedAt), now.AddDays(-500));
            db.Messages.AddRange(old, new Message("hi", "today", Owner, Guid.NewGuid()));
            await db.SaveChangesAsync();
        }

        await using (var scope = provider.CreateAsyncScope())
        {
            var result = await RunAsync(new MessageRetentionPurgePolicy(new PostgresRetentionLock(), NullLogger<MessageRetentionPurgePolicy>.Instance), scope.ServiceProvider, Live(o => o.PurgeMessages = true), now);
            Assert.Equal(1, result.Deleted);
        }

        await using (var scope = provider.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<MessagingDbContext>();
            Assert.Equal(1, await db.Messages.IgnoreQueryFilters().CountAsync());
        }
    }

    [PostgresFact]
    public async Task AdvisoryLock_HoldsAgainstASecondSession_UntilReleased()
    {
        var (database, provider) = await CreateAsync<MessagingDbContext>(o => new MessagingDbContext(o));
        await using var _ = database;
        await using var __ = provider;
        var key = PostgresAdvisoryLock.KeyFor("retention-lock-test");

        await using var first = provider.CreateAsyncScope();
        await using var second = provider.CreateAsyncScope();
        var a = first.ServiceProvider.GetRequiredService<MessagingDbContext>();
        var b = second.ServiceProvider.GetRequiredService<MessagingDbContext>();
        var retentionLock = new PostgresRetentionLock();

        Assert.True(await retentionLock.TryAcquireAsync(a, key, CancellationToken.None));
        // Another replica's pass, on its own connection, must skip rather than purge alongside.
        Assert.False(await retentionLock.TryAcquireAsync(b, key, CancellationToken.None));

        await retentionLock.ReleaseAsync(a, key);
        Assert.True(await retentionLock.TryAcquireAsync(b, key, CancellationToken.None));
        await retentionLock.ReleaseAsync(b, key);
    }
}
