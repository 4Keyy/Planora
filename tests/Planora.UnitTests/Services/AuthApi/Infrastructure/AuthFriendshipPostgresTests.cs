using System.Data.Common;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Planora.Auth.Application.Common.Interfaces;
using Planora.Auth.Application.Features.Friendships.Commands.SendFriendRequest;
using Planora.Auth.Application.Features.Friendships.Commands.SendFriendRequestByEmail;
using Planora.Auth.Domain.Entities;
using Planora.Auth.Domain.Enums;
using Planora.Auth.Domain.ValueObjects;
using Planora.Auth.Infrastructure.Persistence;
using Planora.Auth.Infrastructure.Persistence.Repositories;
using Planora.BuildingBlocks.Application.Messaging;
using Planora.BuildingBlocks.Application.Services;
using Planora.UnitTests.BuildingBlocks.Retention.Postgres;

namespace Planora.UnitTests.Services.AuthApi.Infrastructure;

public sealed class AuthFriendshipPostgresTests
{
    [PostgresFact]
    public Task SendAsync_ReciprocalGuidAndEmailRequests_CommitOnePendingAndKeepGenericEmailResult() =>
        CheckConcurrentSendAsync(reciprocal: true, secondByEmail: true);

    [PostgresFact]
    public Task SendAsync_ReciprocalGuidRequests_CommitOnePending() =>
        CheckConcurrentSendAsync(reciprocal: true, secondByEmail: false);

    [PostgresFact]
    public Task SendAsync_SameDirectionGuidRequests_CommitOnePending() =>
        CheckConcurrentSendAsync(reciprocal: false, secondByEmail: false);

    [PostgresFact]
    public Task SendAsync_RetainedRejectedRowDoesNotHidePendingPair() => CheckActivePreferenceAsync(accepted: false);

    [PostgresFact]
    public Task SendAsync_RetainedRejectedRowDoesNotHideAcceptedPair() => CheckActivePreferenceAsync(accepted: true);

    [PostgresFact]
    public async Task SendAsync_CancellationDuringInsertRollsBackAndAllowsRetry()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        var (requester, target) = await SeedUsersAsync(database);
        using var attempt = new CancellationTokenSource();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        await using var context = CreateContext(new DbContextOptionsBuilder<AuthDbContext>(database.Options<AuthDbContext>())
            .AddInterceptors(new CancelFirstSave(attempt))
            .Options);
        var businessLogger = new Mock<IBusinessEventLogger>();
        var handler = SendById(context, requester.Id, businessLogger.Object);
        var command = new SendFriendRequestCommand(target.Id);

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => handler.Handle(command, attempt.Token));
        await using var verify = CreateContext(database.Options<AuthDbContext>());
        Assert.Empty(await verify.Friendships.AsNoTracking().ToListAsync(timeout.Token));
        businessLogger.Verify(x => x.LogBusinessEvent(
            BusinessEvents.FriendRequestSent, It.IsAny<string>(), It.IsAny<object>(), It.IsAny<string>()), Times.Never);

        Assert.True((await handler.Handle(command, timeout.Token)).IsSuccess);
        Assert.Equal(FriendshipStatus.Pending,
            Assert.Single(await verify.Friendships.AsNoTracking().ToListAsync(timeout.Token)).Status);
        businessLogger.Verify(x => x.LogBusinessEvent(
            BusinessEvents.FriendRequestSent, It.IsAny<string>(), It.IsAny<object>(), It.IsAny<string>()), Times.Once);
    }

    private static async Task CheckConcurrentSendAsync(bool reciprocal, bool secondByEmail)
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        var (firstUser, secondUser) = await SeedUsersAsync(database);
        var secondRequester = reciprocal ? secondUser : firstUser;
        var secondTarget = reciprocal ? firstUser : secondUser;
        var race = new SendRace();
        await using var firstContext = CreateContext(WithGate(database, race));
        await using var secondContext = CreateContext(WithGate(database, race));
        var businessLogger = new Mock<IBusinessEventLogger>();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));

        var first = SendById(firstContext, firstUser.Id, businessLogger.Object)
            .Handle(new SendFriendRequestCommand(secondUser.Id), timeout.Token);
        var second = secondByEmail
            ? SendByEmail(secondContext, secondRequester.Id, businessLogger.Object)
                .Handle(new SendFriendRequestByEmailCommand(secondTarget.Email.Value), timeout.Token)
            : SendById(secondContext, secondRequester.Id, businessLogger.Object)
                .Handle(new SendFriendRequestCommand(secondTarget.Id), timeout.Token);
        var results = await Task.WhenAll(first, second);
        Assert.True(race.BothReached);

        await using var verify = CreateContext(database.Options<AuthDbContext>());
        if (secondByEmail)
        {
            var missingTarget = await SendByEmail(verify, secondRequester.Id, businessLogger.Object)
                .Handle(new SendFriendRequestByEmailCommand("absent-friend@example.test"), timeout.Token);
            Assert.True(missingTarget.IsSuccess);
            Assert.Equal(missingTarget.IsSuccess, results[1].IsSuccess);
            Assert.Null(results[1].Error);
        }

        var stored = Assert.Single(await verify.Friendships.AsNoTracking().ToListAsync(timeout.Token));
        Assert.Equal(FriendshipStatus.Pending, stored.Status);
        if (secondByEmail)
        {
            Assert.Equal(stored.RequesterId == firstUser.Id, results[0].IsSuccess);
            if (results[0].IsFailure)
                Assert.Equal("PENDING_REQUEST", results[0].Error!.Code);
        }
        else
        {
            Assert.Single(results, result => result.IsSuccess);
            Assert.Equal("PENDING_REQUEST", Assert.Single(results, result => result.IsFailure).Error!.Code);
            if (reciprocal)
                Assert.Equal(results[0].IsSuccess ? firstUser.Id : secondUser.Id, stored.RequesterId);
        }

        if (reciprocal)
            Assert.Contains(stored.RequesterId, new[] { firstUser.Id, secondUser.Id });
        else
            Assert.Equal(firstUser.Id, stored.RequesterId);
        Assert.Equal(stored.RequesterId == firstUser.Id ? secondUser.Id : firstUser.Id, stored.AddresseeId);
        businessLogger.Verify(x => x.LogBusinessEvent(
            BusinessEvents.FriendRequestSent, It.IsAny<string>(), It.IsAny<object>(), It.IsAny<string>()), Times.Once);
    }

    private static async Task CheckActivePreferenceAsync(bool accepted)
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        var (requester, target) = await SeedUsersAsync(database);
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        await using var seed = CreateContext(database.Options<AuthDbContext>());
        var terminal = Friendship.Create(requester.Id, target.Id);
        terminal.Reject(target.Id);
        seed.Friendships.Add(terminal);
        await seed.SaveChangesAsync(timeout.Token);
        var active = Friendship.Create(target.Id, requester.Id);
        if (accepted)
            active.Accept(requester.Id);
        seed.Friendships.Add(active);
        await seed.SaveChangesAsync(timeout.Token);

        await using var sendContext = CreateContext(database.Options<AuthDbContext>());
        await sendContext.Database.OpenConnectionAsync(timeout.Token);
        // The old LIMIT 1 reads the earlier terminal row in this fresh test heap.
        await sendContext.Database.ExecuteSqlRawAsync("""
            SET enable_indexscan = off;
            SET enable_indexonlyscan = off;
            SET enable_bitmapscan = off;
            SET max_parallel_workers_per_gather = 0;
            """, timeout.Token);
        var businessLogger = new Mock<IBusinessEventLogger>();
        var result = await SendById(sendContext, requester.Id, businessLogger.Object)
            .Handle(new SendFriendRequestCommand(target.Id), timeout.Token);

        Assert.True(result.IsFailure);
        Assert.Equal(accepted ? "ALREADY_FRIENDS" : "PENDING_REQUEST", result.Error!.Code);
        await using var verify = CreateContext(database.Options<AuthDbContext>());
        var stored = await verify.Friendships.AsNoTracking().ToListAsync(timeout.Token);
        Assert.Equal(2, stored.Count);
        Assert.Equal(FriendshipStatus.Rejected, Assert.Single(stored, row => row.Id == terminal.Id).Status);
        Assert.Equal(active.Status, Assert.Single(stored, row => row.Id == active.Id).Status);
        var relationship = await new FriendshipRepository(sendContext)
            .GetFriendshipAsync(requester.Id, target.Id, timeout.Token);
        Assert.Equal(active.Id, relationship?.Id);
        businessLogger.Verify(x => x.LogBusinessEvent(
            BusinessEvents.FriendRequestSent, It.IsAny<string>(), It.IsAny<object>(), It.IsAny<string>()), Times.Never);
    }

    private static async Task<(User First, User Second)> SeedUsersAsync(TemporaryDatabase database)
    {
        await using var context = CreateContext(database.Options<AuthDbContext>());
        await AuthDatabaseStartup.EnsureReadyAsync(context, NullLogger.Instance);
        var first = User.Create(Email.Create("audit-friend-one@example.test"), "synthetic-hash", "Audit", "One");
        var second = User.Create(Email.Create("audit-friend-two@example.test"), "synthetic-hash", "Audit", "Two");
        first.VerifyEmail();
        second.VerifyEmail();
        context.Users.AddRange(first, second);
        await context.SaveChangesAsync();
        return (first, second);
    }

    private static SendFriendRequestCommandHandler SendById(
        AuthDbContext context, Guid requester, IBusinessEventLogger businessLogger) =>
        new(new FriendshipRepository(context), new UserRepository(context), CurrentUser(requester),
            NullLogger<SendFriendRequestCommandHandler>.Instance, businessLogger);

    private static SendFriendRequestByEmailCommandHandler SendByEmail(
        AuthDbContext context, Guid requester, IBusinessEventLogger businessLogger) =>
        new(new FriendshipRepository(context), new UserRepository(context), CurrentUser(requester),
            NullLogger<SendFriendRequestByEmailCommandHandler>.Instance, businessLogger);

    private static ICurrentUserService CurrentUser(Guid userId)
    {
        var user = new Mock<ICurrentUserService>();
        user.SetupGet(x => x.UserId).Returns(userId);
        return user.Object;
    }

    private static AuthDbContext CreateContext(DbContextOptions<AuthDbContext> options) =>
        new(options, Mock.Of<IDomainEventDispatcher>());

    private static DbContextOptions<AuthDbContext> WithGate(TemporaryDatabase database, SendRace race) =>
        new DbContextOptionsBuilder<AuthDbContext>(database.Options<AuthDbContext>())
            .AddInterceptors(new PairCommandGate(race))
            .Options;

    private sealed class CancelFirstSave(CancellationTokenSource attempt) : SaveChangesInterceptor
    {
        public override ValueTask<InterceptionResult<int>> SavingChangesAsync(
            DbContextEventData eventData,
            InterceptionResult<int> result,
            CancellationToken cancellationToken = default)
        {
            if (cancellationToken == attempt.Token)
            {
                attempt.Cancel();
                cancellationToken.ThrowIfCancellationRequested();
            }
            return ValueTask.FromResult(result);
        }
    }

    private sealed class SendRace
    {
        private readonly TaskCompletionSource _ready = new(TaskCreationOptions.RunContinuationsAsynchronously);
        private int _arrivals;

        public bool BothReached => _ready.Task.IsCompletedSuccessfully;

        public Task ArriveAsync(CancellationToken token)
        {
            if (Interlocked.Increment(ref _arrivals) == 2)
                _ready.TrySetResult();
            return _ready.Task.WaitAsync(TimeSpan.FromSeconds(10), token);
        }
    }

    private sealed class PairCommandGate(SendRace race) : DbCommandInterceptor
    {
        private bool _arrived;

        // On the original path, hold the two completed SELECTs before either request can insert.
        public override async ValueTask<DbDataReader> ReaderExecutedAsync(
            DbCommand command, CommandExecutedEventData eventData, DbDataReader result,
            CancellationToken cancellationToken = default)
        {
            if (command.CommandText.StartsWith("SELECT", StringComparison.Ordinal) &&
                command.CommandText.Contains("\"Friendships\"", StringComparison.Ordinal))
            {
                await ArriveOnceAsync(cancellationToken);
            }
            return result;
        }

        // On the serialized path, meet before acquiring the lock so neither side waits while holding it.
        public override async ValueTask<InterceptionResult<int>> NonQueryExecutingAsync(
            DbCommand command, CommandEventData eventData, InterceptionResult<int> result,
            CancellationToken cancellationToken = default)
        {
            if (IsAdvisoryLock(command))
                await ArriveOnceAsync(cancellationToken);
            return result;
        }

        public override async ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(
            DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result,
            CancellationToken cancellationToken = default)
        {
            if (IsAdvisoryLock(command))
                await ArriveOnceAsync(cancellationToken);
            return result;
        }

        private static bool IsAdvisoryLock(DbCommand command) =>
            command.CommandText.Contains("pg_advisory_xact_lock", StringComparison.Ordinal);

        private Task ArriveOnceAsync(CancellationToken token)
        {
            if (_arrived)
                return Task.CompletedTask;
            _arrived = true;
            return race.ArriveAsync(token);
        }
    }
}
