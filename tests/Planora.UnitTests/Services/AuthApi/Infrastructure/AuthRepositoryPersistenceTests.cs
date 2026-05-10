using Planora.Auth.Domain.Entities;
using Planora.Auth.Domain.Enums;
using Planora.Auth.Domain.ValueObjects;
using Planora.Auth.Infrastructure.Persistence;
using Planora.Auth.Infrastructure.Persistence.Repositories;
using Planora.BuildingBlocks.Infrastructure.Inbox;
using Planora.BuildingBlocks.Infrastructure.Outbox;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Moq;
using AuthEventDispatcher = Planora.BuildingBlocks.Infrastructure.Messaging.IDomainEventDispatcher;

namespace Planora.UnitTests.Services.AuthApi.Infrastructure;

public sealed class AuthRepositoryPersistenceTests
{
    [Fact]
    [Trait("TestType", "Module")]
    [Trait("TestType", "Integration")]
    [Trait("TestType", "Regression")]
    public async Task BaseRepository_ShouldCoverQueriesPagingBulkUpdatesAndDeletes()
    {
        using var context = CreateContext();
        var repository = new UserRepository(context);
        var ada = CreateUser("ada@example.com", "Ada", "Lovelace");
        var grace = CreateUser("grace@example.com", "Grace", "Hopper");
        var alan = CreateUser("alan@example.com", "Alan", "Turing");

        await repository.AddAsync(ada);
        await repository.AddRangeAsync(new[] { grace, alan });
        Assert.True(await repository.SaveChangesAsync() > 0);

        Assert.Same(ada, await repository.GetByIdAsync(ada.Id));
        Assert.Equal(3, (await repository.GetAllAsync()).Count);
        Assert.Equal(new[] { "Ada", "Alan" }, (await repository.FindAsync(u => u.FirstName.StartsWith("A")))
            .Select(u => u.FirstName)
            .OrderBy(name => name));
        Assert.Equal("Grace", (await repository.FindFirstAsync(u => u.LastName == "Hopper"))?.FirstName);
        Assert.True(await repository.ExistsAsync(u => u.Email.Value == "ada@example.com"));
        Assert.False(await repository.ExistsAsync(u => u.Email.Value == "missing@example.com"));
        Assert.Equal(3, await repository.CountAsync());
        Assert.Equal(2, await repository.CountAsync(u => u.FirstName.StartsWith("A")));

        var ascendingPage = await repository.GetPagedAsync(1, 2, orderBy: u => u.LastName);
        Assert.Equal(3, ascendingPage.TotalCount);
        Assert.Equal(new[] { "Hopper", "Lovelace" }, ascendingPage.Items.Select(u => u.LastName));

        var descendingFilteredPage = await repository.GetPagedAsync(
            1,
            1,
            predicate: u => u.Email.Value.Contains("example.com"),
            orderBy: u => u.FirstName,
            ascending: false);
        Assert.Equal(3, descendingFilteredPage.TotalCount);
        Assert.Equal("Grace", Assert.Single(descendingFilteredPage.Items).FirstName);

        ada.UpdateProfile("Augusta", "Lovelace", "https://example.com/profile.png", ada.Id);
        grace.UpdateProfile("Grace", "Brewster Hopper", null, grace.Id);
        repository.Update(ada);
        repository.UpdateRange(new[] { grace });
        await repository.SaveChangesAsync();

        Assert.Equal("Augusta", (await repository.GetByIdAsync(ada.Id))?.FirstName);
        Assert.Equal("Brewster Hopper", (await repository.GetByIdAsync(grace.Id))?.LastName);

        repository.Remove(alan);
        repository.RemoveRange(new[] { grace });
        await repository.SaveChangesAsync();

        Assert.Equal(1, await repository.CountAsync());
        Assert.Equal("Augusta", Assert.Single(await repository.GetAllAsync()).FirstName);
    }

    [Fact]
    [Trait("TestType", "Module")]
    [Trait("TestType", "Integration")]
    [Trait("TestType", "Regression")]
    public async Task UserRepository_ShouldResolveUsersByAllSecurityTokensAndRecordFailedLogins()
    {
        using var context = CreateContext();
        var repository = new UserRepository(context);
        var user = CreateUser("security@example.com", "Security", "User");
        user.SetPasswordResetToken("password-reset-hash", DateTime.UtcNow.AddHours(1));
        user.SetEmailVerificationToken("email-verification-hash", DateTime.UtcNow.AddHours(1));
        var refreshToken = user.AddRefreshToken("refresh-token", "127.0.0.1", DateTime.UtcNow.AddDays(7));

        context.Users.Add(user);
        context.LoginHistory.Add(CreateLoginHistory(user.Id, "old-browser", DateTime.UtcNow.AddDays(-2)));
        context.LoginHistory.Add(CreateLoginHistory(user.Id, "new-browser", DateTime.UtcNow));
        await context.SaveChangesAsync();
        context.ChangeTracker.Clear();

        Assert.Equal(user.Id, (await repository.GetByEmailAsync(Email.Create("security@example.com")))?.Id);
        Assert.True(await repository.ExistsByEmailAsync(Email.Create("security@example.com")));
        Assert.False(await repository.ExistsByEmailAsync(Email.Create("missing@example.com")));

        var withRefreshTokens = await repository.GetWithRefreshTokensAsync(user.Id);
        Assert.NotNull(withRefreshTokens);
        Assert.Contains(withRefreshTokens!.RefreshTokens, token => token.Token == refreshToken.Token);

        Assert.Equal(user.Id, (await repository.GetByRefreshTokenAsync("refresh-token"))?.Id);
        Assert.Equal(user.Id, (await repository.GetByPasswordResetTokenAsync("password-reset-hash"))?.Id);
        Assert.Equal(user.Id, (await repository.GetByEmailVerificationTokenAsync("email-verification-hash"))?.Id);
        Assert.Null(await repository.GetByRefreshTokenAsync("missing-refresh-token"));
        Assert.Null(await repository.GetByPasswordResetTokenAsync("missing-password-token"));
        Assert.Null(await repository.GetByEmailVerificationTokenAsync("missing-email-token"));

        var withHistory = await repository.GetWithLoginHistoryAsync(user.Id, count: 1);
        Assert.NotNull(withHistory);
        Assert.Equal("new-browser", Assert.Single(withHistory!.LoginHistory).UserAgent);
        Assert.Null(await repository.GetWithLoginHistoryAsync(Guid.NewGuid()));

        for (var attempt = 1; attempt <= 5; attempt++)
        {
            await repository.HandleFailedLoginAsync(user.Id);
        }

        var lockedUser = await repository.GetByIdAsync(user.Id);
        Assert.NotNull(lockedUser);
        Assert.Equal(5, lockedUser!.FailedLoginAttempts);
        Assert.True(lockedUser.IsLocked());

        await repository.HandleFailedLoginAsync(Guid.NewGuid());
        Assert.Equal(1, await repository.CountAsync());
    }

    [Fact]
    [Trait("TestType", "Module")]
    [Trait("TestType", "Integration")]
    [Trait("TestType", "Regression")]
    public async Task SessionRepositories_ShouldFilterActiveTokensAndLoginHistory()
    {
        using var context = CreateContext();
        var tokenRepository = new RefreshTokenRepository(context);
        var historyRepository = new LoginHistoryRepository(context);
        var user = CreateUser("sessions@example.com", "Session", "Owner");
        var active = new RefreshToken(user.Id, "active-token", "127.0.0.1", DateTime.UtcNow.AddDays(7), true, "device-a", "Chrome");
        var expired = new RefreshToken(user.Id, "expired-token", "127.0.0.1", DateTime.UtcNow.AddDays(7), false, "device-b", "Edge");
        expired.Revoke("127.0.0.1", "expired for test");
        var oldUserToken = new RefreshToken(Guid.NewGuid(), "other-user-token", "127.0.0.1", DateTime.UtcNow.AddDays(7), false, "device-a", "Chrome");

        context.Users.Add(user);
        context.RefreshTokens.AddRange(active, expired, oldUserToken);
        context.LoginHistory.Add(CreateLoginHistory(user.Id, "old-failed", DateTime.UtcNow.AddHours(-3), isSuccessful: false));
        context.LoginHistory.Add(CreateLoginHistory(user.Id, "recent-success", DateTime.UtcNow.AddMinutes(-5), isSuccessful: true));
        context.LoginHistory.Add(CreateLoginHistory(user.Id, "recent-failed", DateTime.UtcNow.AddMinutes(-1), isSuccessful: false));
        await context.SaveChangesAsync();

        Assert.Equal(active.Id, (await tokenRepository.GetByTokenAsync("active-token"))?.Id);
        Assert.Null(await tokenRepository.GetByTokenAsync("missing-token"));
        Assert.Equal("active-token", Assert.Single(await tokenRepository.GetActiveTokensByUserIdAsync(user.Id)).Token);
        Assert.Equal(active.Id, (await tokenRepository.FindActiveByUserAndDeviceAsync(user.Id, "device-a"))?.Id);
        Assert.Null(await tokenRepository.FindActiveByUserAndDeviceAsync(user.Id, "device-b"));

        var loginHistory = await historyRepository.GetByUserIdAsync(user.Id, count: 2);
        Assert.Equal(2, loginHistory.Count);
        Assert.Equal("recent-failed", loginHistory[0].UserAgent);
        Assert.Equal("recent-success", loginHistory[1].UserAgent);

        var recentFailures = await historyRepository.GetRecentFailedAttemptsAsync(user.Id, TimeSpan.FromMinutes(30));
        Assert.Equal("recent-failed", Assert.Single(recentFailures).UserAgent);

        await tokenRepository.DeleteExpiredTokensAsync(DateTime.UtcNow.AddDays(8));
        Assert.Empty(context.RefreshTokens);

        await historyRepository.DeleteOldHistoryAsync(DateTime.UtcNow.AddHours(-1));
        Assert.DoesNotContain(context.LoginHistory, history => history.UserAgent == "old-failed");
        Assert.Equal(2, context.LoginHistory.Count());
    }

    [Fact]
    [Trait("TestType", "Module")]
    [Trait("TestType", "Integration")]
    [Trait("TestType", "Regression")]
    public async Task PasswordHistoryRepository_ShouldKeepNewestEntriesWhenDeletingOldHistory()
    {
        using var context = CreateContext();
        var repository = new PasswordHistoryRepository(context);
        var userId = Guid.NewGuid();
        var oldest = CreatePasswordHistory(userId, "oldest", DateTime.UtcNow.AddDays(-3));
        var middle = CreatePasswordHistory(userId, "middle", DateTime.UtcNow.AddDays(-2));
        var newest = CreatePasswordHistory(userId, "newest", DateTime.UtcNow.AddDays(-1));
        var otherUser = CreatePasswordHistory(Guid.NewGuid(), "other", DateTime.UtcNow.AddDays(-10));

        context.PasswordHistory.AddRange(oldest, middle, newest, otherUser);
        await context.SaveChangesAsync();

        var latestTwo = await repository.GetByUserIdAsync(userId, count: 2);
        Assert.Equal(new[] { "newest", "middle" }, latestTwo.Select(history => history.PasswordHash));

        await repository.DeleteOldHistoryAsync(userId, keepCount: 2);

        Assert.Equal(new[] { "middle", "newest" }, context.PasswordHistory
            .Where(history => history.UserId == userId)
            .Select(history => history.PasswordHash)
            .OrderBy(hash => hash));
        Assert.Contains(context.PasswordHistory, history => history.PasswordHash == "other");

        await repository.DeleteOldHistoryAsync(userId, keepCount: 5);
        Assert.Equal(3, context.PasswordHistory.Count());
    }

    [Fact]
    [Trait("TestType", "Module")]
    [Trait("TestType", "Integration")]
    [Trait("TestType", "Regression")]
    public async Task AuthUnitOfWork_ShouldLazilyExposeRepositoriesAndPersistChanges()
    {
        using var context = CreateContext();
        using var unitOfWork = new AuthUnitOfWork(context);

        Assert.False(unitOfWork.HasActiveTransaction);
        Assert.Same(unitOfWork.Users, unitOfWork.Users);
        Assert.Same(unitOfWork.RefreshTokens, unitOfWork.RefreshTokens);
        Assert.Same(unitOfWork.LoginHistory, unitOfWork.LoginHistory);
        Assert.Same(unitOfWork.PasswordHistory, unitOfWork.PasswordHistory);

        await unitOfWork.Users.AddAsync(CreateUser("uow@example.com", "Unit", "Work"));
        Assert.True(await unitOfWork.SaveChangesAsync() > 0);
        Assert.True(await unitOfWork.Users.ExistsAsync(user => user.Email.Value == "uow@example.com"));
    }

    [Fact]
    [Trait("TestType", "Module")]
    [Trait("TestType", "Integration")]
    [Trait("TestType", "Regression")]
    public async Task AuthUnitOfWork_ShouldManageTransactionStateAndRejectInvalidOperations()
    {
        using var context = CreateContext();
        using var unitOfWork = new AuthUnitOfWork(context);

        await Assert.ThrowsAsync<InvalidOperationException>(() => unitOfWork.CommitTransactionAsync());
        await Assert.ThrowsAsync<InvalidOperationException>(() => unitOfWork.RollbackTransactionAsync());

        await unitOfWork.BeginTransactionAsync();
        Assert.True(unitOfWork.HasActiveTransaction);
        await Assert.ThrowsAsync<InvalidOperationException>(() => unitOfWork.BeginTransactionAsync());

        await unitOfWork.RollbackTransactionAsync();
        Assert.False(unitOfWork.HasActiveTransaction);

        await unitOfWork.BeginTransactionAsync();
        await unitOfWork.Users.AddAsync(CreateUser("transaction@example.com", "Trans", "Action"));
        await unitOfWork.CommitTransactionAsync();

        Assert.False(unitOfWork.HasActiveTransaction);
        Assert.True(await unitOfWork.Users.ExistsAsync(user => user.Email.Value == "transaction@example.com"));
    }

    [Fact]
    [Trait("TestType", "Module")]
    [Trait("TestType", "Integration")]
    [Trait("TestType", "Regression")]
    public async Task FriendshipRepository_ShouldResolveSymmetricRelationshipsAndAcceptedFriendIds()
    {
        using var context = CreateContext();
        var repository = new FriendshipRepository(context);
        var userId = Guid.NewGuid();
        var acceptedFriendId = Guid.NewGuid();
        var pendingFriendId = Guid.NewGuid();
        var reverseFriendId = Guid.NewGuid();
        var accepted = Friendship.Create(userId, acceptedFriendId);
        accepted.Accept(acceptedFriendId);
        var pending = Friendship.Create(userId, pendingFriendId);
        var reverseAccepted = Friendship.Create(reverseFriendId, userId);
        reverseAccepted.Accept(userId);
        context.Users.AddRange(
            CreateUserWithId(userId, "friend-owner@example.com"),
            CreateUserWithId(acceptedFriendId, "accepted-friend@example.com"),
            CreateUserWithId(pendingFriendId, "pending-friend@example.com"),
            CreateUserWithId(reverseFriendId, "reverse-friend@example.com"));
        context.Friendships.AddRange(accepted, pending, reverseAccepted);
        await context.SaveChangesAsync();

        Assert.Equal(accepted.Id, (await repository.GetFriendshipAsync(acceptedFriendId, userId))?.Id);
        Assert.Null(await repository.GetFriendshipAsync(userId, Guid.NewGuid()));
        Assert.Equal(3, (await repository.GetFriendshipsForUserAsync(userId)).Count);
        Assert.Equal(2, (await repository.GetFriendshipsForUserAsync(userId, FriendshipStatus.Accepted)).Count);
        Assert.True(await repository.AreFriendsAsync(userId, acceptedFriendId));
        Assert.True(await repository.AreFriendsAsync(userId, reverseFriendId));
        Assert.False(await repository.AreFriendsAsync(userId, pendingFriendId));
        Assert.Equal(
            new[] { acceptedFriendId, reverseFriendId }.OrderBy(id => id),
            (await repository.GetFriendIdsAsync(userId)).OrderBy(id => id));
    }

    [Fact]
    [Trait("TestType", "Module")]
    [Trait("TestType", "Integration")]
    [Trait("TestType", "Regression")]
    public async Task AuthOutboxRepository_ShouldSelectPendingMessagesAndDeleteOldProcessedMessages()
    {
        using var context = CreateContext();
        var repository = new OutboxRepository(context);
        var oldestPending = new OutboxMessage("OldPending", "{}", DateTime.UtcNow.AddMinutes(-10));
        var newestPending = new OutboxMessage("NewPending", "{}", DateTime.UtcNow.AddMinutes(-1));
        var processedOld = new OutboxMessage("ProcessedOld", "{}", DateTime.UtcNow.AddMinutes(-20));
        processedOld.MarkAsProcessed();
        SetProperty(processedOld, nameof(OutboxMessage.ProcessedOnUtc), DateTime.UtcNow.AddDays(-2));
        var processedRecent = new OutboxMessage("ProcessedRecent", "{}", DateTime.UtcNow);
        processedRecent.MarkAsProcessed();
        context.OutboxMessages.AddRange(newestPending, processedOld, oldestPending, processedRecent);
        await context.SaveChangesAsync();
        var addedViaRepository = new OutboxMessage("AddedViaRepository", "{}", DateTime.UtcNow.AddMinutes(-5));
        await repository.AddAsync(addedViaRepository);

        var pending = await repository.GetPendingMessagesAsync(batchSize: 2);
        Assert.Equal(new[] { "OldPending", "AddedViaRepository" }, pending.Select(message => message.Type));
        var unprocessed = await repository.GetUnprocessedMessagesAsync(batchSize: 10);
        Assert.Contains(unprocessed, message => message.Type == "NewPending");

        addedViaRepository.MarkAsProcessing();
        await repository.UpdateAsync(addedViaRepository);
        Assert.Equal(
            OutboxMessageStatus.Processing,
            (await context.OutboxMessages.FindAsync(addedViaRepository.Id))!.Status);

        await repository.DeleteProcessedMessagesAsync(DateTime.UtcNow.AddDays(-1));

        Assert.DoesNotContain(context.OutboxMessages, message => message.Type == "ProcessedOld");
        Assert.Contains(context.OutboxMessages, message => message.Type == "ProcessedRecent");
        Assert.Contains(context.OutboxMessages, message => message.Type == "OldPending");
    }

    [Fact]
    [Trait("TestType", "Module")]
    [Trait("TestType", "Integration")]
    [Trait("TestType", "Regression")]
    public async Task AuthInboxRepository_ShouldPersistLookupExistAndDeleteOldProcessedMessages()
    {
        using var context = CreateContext();
        var repository = new InboxRepository(context);
        var oldProcessed = new InboxMessage("old", "Old", "{}", DateTime.UtcNow.AddDays(-3));
        oldProcessed.MarkAsProcessed();
        SetProperty(oldProcessed, nameof(InboxMessage.ProcessedOn), DateTime.UtcNow.AddDays(-2));
        var recentProcessed = new InboxMessage("recent", "Recent", "{}", DateTime.UtcNow);
        recentProcessed.MarkAsProcessed();
        var pending = new InboxMessage("pending", "Pending", "{}", DateTime.UtcNow);

        await repository.AddAsync(oldProcessed);
        await repository.AddAsync(recentProcessed);
        await repository.AddAsync(pending);

        Assert.Same(pending, await repository.GetByIdAsync(pending.Id));
        Assert.True(await repository.ExistsAsync(pending.Id));
        pending.MarkAsFailed("handler failed");
        await repository.UpdateAsync(pending);
        Assert.Equal(InboxMessageStatus.Failed, (await repository.GetByIdAsync(pending.Id))!.Status);

        await repository.DeleteProcessedMessagesAsync(DateTime.UtcNow.AddDays(-1));

        Assert.False(await repository.ExistsAsync(oldProcessed.Id));
        Assert.True(await repository.ExistsAsync(recentProcessed.Id));
        Assert.True(await repository.ExistsAsync(pending.Id));
    }

    private static AuthDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<AuthDbContext>()
            .UseInMemoryDatabase($"auth-repository-{Guid.NewGuid():N}")
            .ConfigureWarnings(warnings => warnings.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .Options;

        return new AuthDbContext(options, Mock.Of<AuthEventDispatcher>());
    }

    private static User CreateUser(string email, string firstName, string lastName)
    {
        var user = User.Create(Email.Create(email), "hashed-password", firstName, lastName);
        user.ClearDomainEvents();
        return user;
    }

    private static User CreateUserWithId(Guid id, string email)
    {
        var user = CreateUser(email, "Test", "User");
        SetProperty(user, nameof(User.Id), id);
        return user;
    }

    private static LoginHistory CreateLoginHistory(
        Guid userId,
        string userAgent,
        DateTime loginAt,
        bool isSuccessful = true)
    {
        var history = new LoginHistory(userId, "127.0.0.1", userAgent, isSuccessful, isSuccessful ? null : "failed");
        SetProperty(history, nameof(LoginHistory.LoginAt), loginAt);
        return history;
    }

    private static PasswordHistory CreatePasswordHistory(Guid userId, string passwordHash, DateTime changedAt)
    {
        var history = new PasswordHistory(userId, passwordHash);
        SetProperty(history, nameof(PasswordHistory.ChangedAt), changedAt);
        return history;
    }

    private static void SetProperty<T>(T instance, string propertyName, object value)
    {
        var property = typeof(T).GetProperty(propertyName)
            ?? throw new InvalidOperationException($"Property {propertyName} was not found on {typeof(T).Name}.");
        property.SetValue(instance, value);
    }
}
