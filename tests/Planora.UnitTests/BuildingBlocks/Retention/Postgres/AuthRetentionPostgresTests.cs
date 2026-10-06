using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Planora.Auth.Application.Common.Interfaces;
using Planora.Auth.Domain.Entities;
using Planora.Auth.Domain.ValueObjects;
using Planora.Auth.Infrastructure.Auditing;
using Planora.Auth.Infrastructure.Persistence;
using Planora.Auth.Infrastructure.Retention;
using Planora.BuildingBlocks.Application.Messaging;
using Planora.BuildingBlocks.Application.Outbox;
using Planora.BuildingBlocks.Infrastructure.Inbox;
using Planora.BuildingBlocks.Infrastructure.Retention;
using Planora.BuildingBlocks.Infrastructure.Retention.Policies;
using static Planora.UnitTests.BuildingBlocks.Retention.Postgres.RetentionTestKit;

namespace Planora.UnitTests.BuildingBlocks.Retention.Postgres;

/// <summary>
/// AuthApi's retention, live on PostgreSQL: a deleted account is physically removed past the grace window
/// together with every Auth row that depends on it (the friendship FK is RESTRICT, so the order matters),
/// expired refresh tokens and spent recovery codes are reaped, and the opt-in forensic and friendship
/// vectors delete exactly their window when switched on.
/// </summary>
[Trait("TestType", "Integration")]
public sealed class AuthRetentionPostgresTests
{
    private static async Task<(TemporaryDatabase Database, ServiceProvider Services)> CreateAsync(IAvatarStorage? avatars = null)
    {
        var database = await TemporaryDatabase.CreateAsync();
        var services = new ServiceCollection();
        services.AddScoped(_ => new AuthDbContext(database.Options<AuthDbContext>(), Mock.Of<IDomainEventDispatcher>()));
        if (avatars is not null) services.AddSingleton(avatars);
        services.AddScoped<DbContext>(sp => sp.GetRequiredService<AuthDbContext>());
        var provider = services.BuildServiceProvider();

        await using var scope = provider.CreateAsyncScope();
        await scope.ServiceProvider.GetRequiredService<AuthDbContext>().Database.EnsureCreatedAsync();
        return (database, provider);
    }

    private static User NewUser(string name) =>
        User.Create(Email.Create($"{name}-{Guid.NewGuid():N}@example.test"), "hash", name, "Test");

    /// <summary>A user with one of every Auth-owned dependent row, befriended with <paramref name="friend"/>.</summary>
    private static void AddWithDependents(AuthDbContext db, User user, User friend, Role role)
    {
        db.Users.Add(user);
        db.RefreshTokens.Add(new RefreshToken(user.Id, $"token-{Guid.NewGuid():N}", "127.0.0.1", DateTime.UtcNow.AddDays(7)));
        db.LoginHistory.Add(new LoginHistory(user.Id, "127.0.0.1", "test-agent", true));
        db.PasswordHistory.Add(new PasswordHistory(user.Id, "old-hash"));
        db.UserRecoveryCodes.Add(new UserRecoveryCode(user.Id, $"code-{Guid.NewGuid():N}"));
        db.UserRoles.Add(UserRole.Create(user.Id, role.Id));
        db.Friendships.Add(Friendship.Create(user.Id, friend.Id));
    }

    [PostgresFact]
    public async Task DeletedAccounts_ArePurgedPastGrace_WithEveryDependentRow_AndTheirAvatars()
    {
        var avatars = new Mock<IAvatarStorage>();
        var (database, provider) = await CreateAsync(avatars.Object);
        await using var _ = database;
        await using var __ = provider;
        var now = DateTime.UtcNow;

        Guid goneA, goneB, recent, live;
        await using (var scope = provider.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AuthDbContext>();
            var role = Role.Create($"Tester-{Guid.NewGuid():N}");
            db.Roles.Add(role);
            var liveUser = NewUser("live");
            db.Users.Add(liveUser);
            var deletedLongAgo = NewUser("gone-a");
            var deletedLongAgoToo = NewUser("gone-b");
            var deletedYesterday = NewUser("recent");
            AddWithDependents(db, deletedLongAgo, liveUser, role);
            AddWithDependents(db, deletedLongAgoToo, liveUser, role);
            AddWithDependents(db, deletedYesterday, liveUser, role);
            await db.SaveChangesAsync();

            foreach (var (user, deletedAt) in new[] { (deletedLongAgo, now.AddDays(-30)), (deletedLongAgoToo, now.AddDays(-8)), (deletedYesterday, now.AddDays(-1)) })
            {
                user.MarkAsDeleted(user.Id);
                Set(user, nameof(User.DeletedAt), deletedAt);
            }

            await db.SaveChangesAsync();
            (goneA, goneB, recent, live) = (deletedLongAgo.Id, deletedLongAgoToo.Id, deletedYesterday.Id, liveUser.Id);
        }

        RetentionResult result;
        await using (var scope = provider.CreateAsyncScope())
        {
            var policy = new UserSoftDeletePurgePolicy(new PostgresRetentionLock(), NullLogger<UserSoftDeletePurgePolicy>.Instance);
            result = await RunAsync(policy, scope.ServiceProvider, Live(o => o.BatchSize = 1), now);
        }

        Assert.Equal(2, result.Scanned);
        Assert.Equal(2, result.Deleted);

        await using (var scope = provider.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AuthDbContext>();
            var users = await db.Users.IgnoreQueryFilters().Select(u => u.Id).ToListAsync();
            Assert.Equal(new[] { recent, live }.Order(), users.Order());

            var gone = new[] { goneA, goneB };
            Assert.False(await db.RefreshTokens.IgnoreQueryFilters().AnyAsync(t => gone.Contains(t.UserId)));
            Assert.False(await db.LoginHistory.IgnoreQueryFilters().AnyAsync(l => gone.Contains(l.UserId)));
            Assert.False(await db.PasswordHistory.IgnoreQueryFilters().AnyAsync(p => gone.Contains(p.UserId)));
            Assert.False(await db.UserRecoveryCodes.IgnoreQueryFilters().AnyAsync(c => gone.Contains(c.UserId)));
            Assert.False(await db.UserRoles.IgnoreQueryFilters().AnyAsync(r => gone.Contains(r.UserId)));
            Assert.False(await db.Friendships.IgnoreQueryFilters().AnyAsync(f => gone.Contains(f.RequesterId) || gone.Contains(f.AddresseeId)));

            // The account deleted yesterday is still inside its grace window, dependents and all.
            Assert.True(await db.RefreshTokens.IgnoreQueryFilters().AnyAsync(t => t.UserId == recent));
            Assert.True(await db.Friendships.IgnoreQueryFilters().AnyAsync(f => f.RequesterId == recent));
        }

        // The photo is a file, not a row: the purge removes each purged account's avatar tree too.
        avatars.Verify(a => a.DeleteAsync(goneA, It.IsAny<CancellationToken>()), Times.Once);
        avatars.Verify(a => a.DeleteAsync(goneB, It.IsAny<CancellationToken>()), Times.Once);
        avatars.Verify(a => a.DeleteAsync(recent, It.IsAny<CancellationToken>()), Times.Never);
    }

    [PostgresFact]
    public async Task TokenAndCodeHousekeeping_ReapsOnlyExpiredTokensAndSpentCodes()
    {
        var (database, provider) = await CreateAsync();
        await using var _ = database;
        await using var __ = provider;
        var now = DateTime.UtcNow;

        await using (var scope = provider.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AuthDbContext>();
            var user = NewUser("tokens");
            db.Users.Add(user);
            // The constructor refuses a past expiry, so tokens are issued valid and then aged.
            RefreshToken Expired(string token, DateTime expiresAt)
            {
                var refreshToken = new RefreshToken(user.Id, token, "127.0.0.1", now.AddDays(1));
                Set(refreshToken, nameof(RefreshToken.ExpiresAt), expiresAt);
                return refreshToken;
            }

            db.RefreshTokens.AddRange(
                Expired("expired-long-ago", now.AddDays(-60)),
                Expired("expired-a-while-ago", now.AddDays(-31)),
                Expired("expired-last-week", now.AddDays(-7)),
                new RefreshToken(user.Id, "valid", "127.0.0.1", now.AddDays(20)));

            UserRecoveryCode Used(DateTime at)
            {
                var code = new UserRecoveryCode(user.Id, $"used-{Guid.NewGuid():N}");
                code.MarkAsUsed();
                Set(code, nameof(UserRecoveryCode.UsedAt), at);
                return code;
            }

            db.UserRecoveryCodes.AddRange(Used(now.AddDays(-45)), Used(now.AddDays(-5)), new UserRecoveryCode(user.Id, "unused"));
            await db.SaveChangesAsync();
        }

        await using (var scope = provider.CreateAsyncScope())
        {
            var tokens = await RunAsync(new ExpiredRefreshTokenPurgePolicy(new PostgresRetentionLock(), NullLogger<ExpiredRefreshTokenPurgePolicy>.Instance), scope.ServiceProvider, Live(), now);
            var codes = await RunAsync(new UsedRecoveryCodePurgePolicy(new PostgresRetentionLock(), NullLogger<UsedRecoveryCodePurgePolicy>.Instance), scope.ServiceProvider, Live(), now);
            Assert.Equal(2, tokens.Deleted);
            Assert.Equal(1, codes.Deleted);
        }

        await using (var scope = provider.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AuthDbContext>();
            // Tokens are stored hashed, so the survivors are told apart by their expiry.
            var expiries = await db.RefreshTokens.IgnoreQueryFilters().Select(t => t.ExpiresAt).ToListAsync();
            Assert.Equal(2, expiries.Count);
            Assert.All(expiries, at => Assert.True(at > now.AddDays(-30)));
            Assert.Equal(2, await db.UserRecoveryCodes.IgnoreQueryFilters().CountAsync());
        }
    }

    [PostgresFact]
    public async Task OptInVectors_WhenSwitchedOn_DeleteExactlyTheirWindow()
    {
        var (database, provider) = await CreateAsync();
        await using var _ = database;
        await using var __ = provider;
        var now = DateTime.UtcNow;

        await using (var scope = provider.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AuthDbContext>();
            var a = NewUser("a");
            var b = NewUser("b");
            var c = NewUser("c");
            db.Users.AddRange(a, b, c);

            var rejectedLongAgo = Friendship.Create(a.Id, b.Id);
            rejectedLongAgo.Reject(b.Id);
            Set(rejectedLongAgo, nameof(Friendship.UpdatedAt), now.AddDays(-120));
            var rejectedRecently = Friendship.Create(c.Id, b.Id);
            rejectedRecently.Reject(b.Id);
            var accepted = Friendship.Create(a.Id, c.Id);
            accepted.Accept(c.Id);
            Set(accepted, nameof(Friendship.UpdatedAt), now.AddDays(-200));
            db.Friendships.AddRange(rejectedLongAgo, rejectedRecently, accepted);

            var oldLogin = new LoginHistory(a.Id, "127.0.0.1", "agent", true);
            Set(oldLogin, nameof(LoginHistory.LoginAt), now.AddDays(-200));
            db.LoginHistory.AddRange(oldLogin, new LoginHistory(a.Id, "127.0.0.1", "agent", true));

            var oldAudit = AuditLog.CreateEventLog("Login", "old", a.Id);
            Set(oldAudit, nameof(AuditLog.CreatedAt), now.AddDays(-400));
            db.AuditLogs.AddRange(oldAudit, AuditLog.CreateEventLog("Login", "recent", a.Id));
            await db.SaveChangesAsync();
        }

        var options = Live(o =>
        {
            o.PurgeFriendships = true;
            o.PurgeLoginHistory = true;
            o.PurgeAuditLogs = true;
        });
        await using (var scope = provider.CreateAsyncScope())
        {
            var friendships = await RunAsync(new FriendshipTerminalPurgePolicy(new PostgresRetentionLock(), NullLogger<FriendshipTerminalPurgePolicy>.Instance), scope.ServiceProvider, options, now);
            var logins = await RunAsync(new LoginHistoryPurgePolicy(new PostgresRetentionLock(), NullLogger<LoginHistoryPurgePolicy>.Instance), scope.ServiceProvider, options, now);
            var audits = await RunAsync(new AuditLogPurgePolicy(new PostgresRetentionLock(), NullLogger<AuditLogPurgePolicy>.Instance), scope.ServiceProvider, options, now);
            Assert.Equal(1, friendships.Deleted);
            Assert.Equal(1, logins.Deleted);
            Assert.Equal(1, audits.Deleted);
        }

        await using (var scope = provider.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AuthDbContext>();
            Assert.Equal(2, await db.Friendships.IgnoreQueryFilters().CountAsync());
            Assert.Equal(1, await db.LoginHistory.IgnoreQueryFilters().CountAsync());
            Assert.Equal(1, await db.AuditLogs.IgnoreQueryFilters().CountAsync());
        }
    }

    [PostgresFact]
    public async Task ProcessedMessagePurge_CleansBothOutboxAndInbox()
    {
        var (database, provider) = await CreateAsync();
        await using var _ = database;
        await using var __ = provider;
        var now = DateTime.UtcNow;

        await using (var scope = provider.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AuthDbContext>();
            var outbox = new OutboxMessage("Evt", "{}", now.AddDays(-10));
            outbox.MarkAsProcessed();
            Set(outbox, nameof(OutboxMessage.ProcessedOnUtc), now.AddDays(-10));
            var inbox = new InboxMessage(Guid.NewGuid(), "Evt", "{}", now.AddDays(-10));
            inbox.MarkAsProcessed();
            Set(inbox, nameof(InboxMessage.ProcessedOn), now.AddDays(-10));
            db.OutboxMessages.AddRange(outbox, new OutboxMessage("Evt", "{}", now));
            db.InboxMessages.AddRange(inbox, new InboxMessage(Guid.NewGuid(), "Evt", "{}", now));
            await db.SaveChangesAsync();
        }

        await using (var scope = provider.CreateAsyncScope())
        {
            var result = await RunAsync(new ProcessedMessagePurgePolicy(new PostgresRetentionLock(), NullLogger<ProcessedMessagePurgePolicy>.Instance), scope.ServiceProvider, Live(), now);
            Assert.Equal(2, result.Deleted);
        }

        await using (var scope = provider.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AuthDbContext>();
            Assert.Equal(1, await db.OutboxMessages.CountAsync());
            Assert.Equal(1, await db.InboxMessages.CountAsync());
        }
    }
}
