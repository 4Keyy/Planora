using System.Data.Common;
using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Npgsql;
using Planora.Auth.Application.Common.Interfaces;
using Planora.Auth.Application.Features.Authentication.Commands.Login;
using Planora.Auth.Application.Features.Authentication.Commands.RefreshToken;
using Planora.Auth.Application.Features.Authentication.Handlers.Login;
using Planora.Auth.Application.Features.Authentication.Handlers.RefreshToken;
using Planora.Auth.Domain.Entities;
using Planora.Auth.Domain.Repositories;
using Planora.Auth.Domain.ValueObjects;
using Planora.Auth.Infrastructure.Persistence;
using Planora.BuildingBlocks.Application.Messaging;
using Planora.BuildingBlocks.Application.Services;
using Planora.UnitTests.BuildingBlocks.Retention.Postgres;

namespace Planora.UnitTests.Services.AuthApi.Infrastructure;

public sealed class AuthSessionPostgresTests
{
    private const string PresentedToken = "synthetic-presented-refresh";
    private const string Ip = "192.0.2.12";
    private const string Agent = "Audit Browser";

    [PostgresFact]
    public Task RefreshAsync_ConsumesLegacyTokenOnce() => CheckConcurrentRefreshAsync(null);

    [PostgresFact]
    public Task RefreshAsync_ConsumesDeviceTokenOnce() => CheckConcurrentRefreshAsync(DeviceFingerprint());

    [PostgresFact]
    public Task RefreshAsync_RollsBackConsume_WhenSuccessorInsertFails() => CheckRefreshRollbackAsync(false);

    [PostgresFact]
    public Task RefreshAsync_RollsBackConsume_WhenSuccessorInsertIsCancelled() => CheckRefreshRollbackAsync(true);

    [PostgresFact]
    public async Task RefreshAsync_RejectsReplay_AndRevokesAConcurrentDescendant()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        await using var seed = CreateContext(database.Options<AuthDbContext>());
        await AuthDatabaseStartup.EnsureReadyAsync(seed, NullLogger.Instance);
        var user = CreateUser();
        var oldToken = CreateToken(user.Id, PresentedToken, null);
        oldToken.Revoke(Ip, "Replaced by new token");
        const string liveValue = "synthetic-live-refresh";
        var liveToken = CreateToken(user.Id, liveValue, null);
        seed.Users.Add(user);
        seed.RefreshTokens.AddRange(oldToken, liveToken);
        await seed.SaveChangesAsync();

        var barrier = new ReplayReadGate();
        var replayOptions = new DbContextOptionsBuilder<AuthDbContext>(database.Options<AuthDbContext>())
            .AddInterceptors(barrier)
            .Options;
        await using var replayContext = CreateContext(replayOptions);
        await using var rotationContext = CreateContext(database.Options<AuthDbContext>());
        using var replayUnit = new AuthUnitOfWork(replayContext);
        using var rotationUnit = new AuthUnitOfWork(rotationContext);
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        var stamp = new Mock<ISecurityStampService>();
        var replay = CreateRefreshHandler(replayUnit, stamp.Object)
            .Handle(new RefreshTokenCommand { RefreshToken = PresentedToken }, timeout.Token);

        try
        {
            await barrier.ReadObserved.Task.WaitAsync(TimeSpan.FromSeconds(10), timeout.Token);
            var rotation = await CreateRefreshHandler(rotationUnit, stamp.Object)
                .Handle(new RefreshTokenCommand { RefreshToken = liveValue }, timeout.Token);
            Assert.True(rotation.IsSuccess);
        }
        finally
        {
            barrier.Resume.TrySetResult();
        }

        var rejected = await replay;
        Assert.Equal("INVALID_REFRESH_TOKEN", rejected.Error?.Code);
        await using var verify = CreateContext(database.Options<AuthDbContext>());
        var rows = await verify.RefreshTokens.AsNoTracking().Where(x => x.UserId == user.Id).ToListAsync();
        Assert.Equal(3, rows.Count);
        var descendant = Assert.Single(rows, x => x.Id != oldToken.Id && x.Id != liveToken.Id);
        Assert.True(descendant.IsRevoked, "The concurrent descendant remained active after replay");
        Assert.Equal("Replaced by new token", Assert.Single(rows, x => x.Id == liveToken.Id).RevokedReason);
        stamp.Verify(x => x.SetStampAsync(user.Id, It.IsAny<CancellationToken>()), Times.Once);
    }

    [PostgresFact]
    public async Task RefreshAsync_ReplayWaitsForInFlightRotationBeforeRevoking()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        await using var seed = CreateContext(database.Options<AuthDbContext>());
        await AuthDatabaseStartup.EnsureReadyAsync(seed, NullLogger.Instance);
        var user = CreateUser();
        var oldToken = CreateToken(user.Id, PresentedToken, null);
        oldToken.Revoke(Ip, "Replaced by new token");
        const string liveValue = "synthetic-live-refresh";
        seed.Users.Add(user);
        seed.RefreshTokens.AddRange(oldToken, CreateToken(user.Id, liveValue, null));
        await seed.SaveChangesAsync();

        var gate = new RotationWriteGate();
        var lockProbe = new ReplayLockProbe();
        var rotationOptions = new DbContextOptionsBuilder<AuthDbContext>(database.Options<AuthDbContext>())
            .AddInterceptors(gate).Options;
        var replayOptions = new DbContextOptionsBuilder<AuthDbContext>(database.Options<AuthDbContext>())
            .AddInterceptors(lockProbe).Options;
        await using var rotationContext = CreateContext(rotationOptions);
        await using var replayContext = CreateContext(replayOptions);
        using var rotationUnit = new AuthUnitOfWork(rotationContext);
        using var replayUnit = new AuthUnitOfWork(replayContext);
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        var stamp = new Mock<ISecurityStampService>();
        var rotation = CreateRefreshHandler(rotationUnit, stamp.Object)
            .Handle(new RefreshTokenCommand { RefreshToken = liveValue }, timeout.Token);

        try
        {
            await gate.Consumed.Task.WaitAsync(TimeSpan.FromSeconds(10), timeout.Token);
            var replay = CreateRefreshHandler(replayUnit, stamp.Object)
                .Handle(new RefreshTokenCommand { RefreshToken = PresentedToken }, timeout.Token);
            try
            {
                var pid = await lockProbe.BackendPid.Task.WaitAsync(TimeSpan.FromSeconds(10), timeout.Token);
                using var observation = CancellationTokenSource.CreateLinkedTokenSource(timeout.Token);
                observation.CancelAfter(TimeSpan.FromSeconds(5));
                while (!await seed.Database.SqlQuery<bool>($"""
                    SELECT EXISTS (
                        SELECT 1 FROM pg_catalog.pg_locks
                        WHERE pid = {pid} AND locktype = 'advisory' AND NOT granted
                    ) AS "Value"
                    """).SingleAsync(observation.Token))
                {
                    await Task.Delay(25, observation.Token);
                }

                Assert.False(replay.IsCompleted);
            }
            finally
            {
                gate.Resume.TrySetResult();
                await replay;
            }

            Assert.True((await rotation).IsSuccess);
            Assert.Equal("INVALID_REFRESH_TOKEN", (await replay).Error?.Code);
        }
        finally
        {
            gate.Resume.TrySetResult();
            await rotation;
        }

        var rows = await seed.RefreshTokens.AsNoTracking().Where(row => row.UserId == user.Id).ToListAsync();
        Assert.Equal(3, rows.Count);
        Assert.All(rows, row => Assert.True(row.IsRevoked));
        stamp.Verify(x => x.SetStampAsync(user.Id, It.IsAny<CancellationToken>()), Times.Once);
    }

    [PostgresFact]
    public Task LoginAsync_ConcurrentExpiredDeviceSession_ReturnsOneSuccess() => CheckConcurrentLoginAsync(true);

    [PostgresFact]
    public Task LoginAsync_ConcurrentActiveDeviceSession_ReturnsOneSuccess() => CheckConcurrentLoginAsync(false);

    [PostgresFact]
    public async Task LoginAsync_RetiresExpiredDeviceToken_AndPreservesOtherSessions()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        await using var seed = CreateContext(database.Options<AuthDbContext>());
        await AuthDatabaseStartup.EnsureReadyAsync(seed, NullLogger.Instance);
        var user = CreateUser();
        var expired = CreateToken(user.Id, PresentedToken, DeviceFingerprint());
        RetentionTestKit.Set(expired, nameof(RefreshToken.ExpiresAt), DateTime.UtcNow.AddHours(-1));
        var revoked = CreateToken(user.Id, "synthetic-older-revoked", DeviceFingerprint());
        revoked.Revoke(Ip, "Prior logout");
        var otherDevice = CreateToken(user.Id, "synthetic-other-device", new string('a', 64));
        seed.Users.Add(user);
        seed.RefreshTokens.AddRange(expired, revoked, otherDevice);
        await seed.SaveChangesAsync();

        await using var loginContext = CreateContext(database.Options<AuthDbContext>());
        using var unit = new AuthUnitOfWork(loginContext);
        var response = await CreateLoginHandler(unit).Handle(LoginRequest(user), CancellationToken.None);

        Assert.True(response.IsSuccess);
        await using var verify = CreateContext(database.Options<AuthDbContext>());
        var rows = await verify.RefreshTokens.AsNoTracking().Where(x => x.UserId == user.Id).ToListAsync();
        var current = Assert.Single(rows, x => x.DeviceFingerprint == DeviceFingerprint() && x.IsActive);
        Assert.True(current.RememberMe);
        Assert.True(current.Matches(response.Value!.RefreshToken));
        Assert.True(Assert.Single(rows, x => x.Id == expired.Id).IsRevoked);
        Assert.Equal("Prior logout", Assert.Single(rows, x => x.Id == revoked.Id).RevokedReason);
        Assert.True(Assert.Single(rows, x => x.Id == otherDevice.Id).IsActive);
    }

    private static async Task CheckConcurrentRefreshAsync(string? fingerprint)
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        await using var seed = CreateContext(database.Options<AuthDbContext>());
        await AuthDatabaseStartup.EnsureReadyAsync(seed, NullLogger.Instance);
        var user = CreateUser();
        var original = CreateToken(user.Id, PresentedToken, fingerprint);
        seed.Users.Add(user);
        seed.RefreshTokens.Add(original);
        await seed.SaveChangesAsync();

        var barrier = new SessionReadBarrier(sql =>
            sql.Contains("\"RefreshTokens\"", StringComparison.Ordinal) && sql.Contains("\"Users\"", StringComparison.Ordinal));
        var options = new DbContextOptionsBuilder<AuthDbContext>(database.Options<AuthDbContext>())
            .AddInterceptors(barrier)
            .Options;
        await using var first = CreateContext(options);
        await using var second = CreateContext(options);
        using var firstUnit = new AuthUnitOfWork(first);
        using var secondUnit = new AuthUnitOfWork(second);
        var stamp = new Mock<ISecurityStampService>();
        var request = new RefreshTokenCommand { RefreshToken = PresentedToken };
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));

        var results = await Task.WhenAll(
            CreateRefreshHandler(firstUnit, stamp.Object).Handle(request, timeout.Token),
            CreateRefreshHandler(secondUnit, stamp.Object).Handle(request, timeout.Token));

        Assert.True(barrier.BothReadsReached);
        var winner = Assert.Single(results, x => x.IsSuccess);
        var loser = Assert.Single(results, x => x.IsFailure);
        Assert.Equal("INVALID_REFRESH_TOKEN", loser.Error?.Code);
        Assert.Throws<InvalidOperationException>(() => loser.Value);
        Assert.True(winner.Value!.RememberMe);
        await using var verify = CreateContext(database.Options<AuthDbContext>());
        var rows = await verify.RefreshTokens.AsNoTracking().Where(x => x.UserId == user.Id).ToListAsync();
        Assert.Equal(2, rows.Count);
        Assert.Equal("Replaced by new token", Assert.Single(rows, x => x.Id == original.Id).RevokedReason);
        var successor = Assert.Single(rows, x => x.Id != original.Id);
        Assert.Equal(fingerprint, successor.DeviceFingerprint);
        Assert.True(successor.Matches(winner.Value.RefreshToken));
        Assert.True(successor.IsRevoked);
        stamp.Verify(x => x.SetStampAsync(user.Id, It.IsAny<CancellationToken>()), Times.Once);
    }

    private static async Task CheckConcurrentLoginAsync(bool expired)
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        await using var seed = CreateContext(database.Options<AuthDbContext>());
        await AuthDatabaseStartup.EnsureReadyAsync(seed, NullLogger.Instance);
        var user = CreateUser();
        var original = CreateToken(user.Id, PresentedToken, DeviceFingerprint());
        if (expired)
            RetentionTestKit.Set(original, nameof(RefreshToken.ExpiresAt), DateTime.UtcNow.AddHours(-1));
        seed.Users.Add(user);
        seed.RefreshTokens.Add(original);
        await seed.SaveChangesAsync();

        var barrier = new SessionReadBarrier(sql => sql.Contains("\"DeviceFingerprint\" =", StringComparison.Ordinal));
        var options = new DbContextOptionsBuilder<AuthDbContext>(database.Options<AuthDbContext>())
            .AddInterceptors(barrier)
            .Options;
        await using var first = CreateContext(options);
        await using var second = CreateContext(options);
        using var firstUnit = new AuthUnitOfWork(first);
        using var secondUnit = new AuthUnitOfWork(second);
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        var request = LoginRequest(user);

        var results = await Task.WhenAll(
            CreateLoginHandler(firstUnit).Handle(request, timeout.Token),
            CreateLoginHandler(secondUnit).Handle(request, timeout.Token));

        Assert.True(barrier.BothReadsReached);
        var winner = Assert.Single(results, x => x.IsSuccess);
        var loser = Assert.Single(results, x => x.IsFailure);
        Assert.Equal("LOGIN_SESSION_CHANGED", loser.Error?.Code);
        await using var verify = CreateContext(database.Options<AuthDbContext>());
        var rows = await verify.RefreshTokens.AsNoTracking().Where(x => x.UserId == user.Id).ToListAsync();
        var active = Assert.Single(rows, x => x.IsActive);
        Assert.True(active.Matches(winner.Value!.RefreshToken));
        Assert.Equal(1, await verify.LoginHistory.CountAsync(x => x.UserId == user.Id && x.IsSuccessful));
        if (expired)
        {
            Assert.Equal(2, rows.Count);
            Assert.True(Assert.Single(rows, x => x.Id == original.Id).IsRevoked);
        }
        else
        {
            Assert.Single(rows);
            Assert.Equal(original.Id, active.Id);
            Assert.Equal(original.LoginCount + 1, active.LoginCount);
        }
    }

    private static async Task CheckRefreshRollbackAsync(bool cancel)
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        await using var seed = CreateContext(database.Options<AuthDbContext>());
        await AuthDatabaseStartup.EnsureReadyAsync(seed, NullLogger.Instance);
        var user = CreateUser();
        var original = CreateToken(user.Id, PresentedToken, DeviceFingerprint());
        seed.Users.Add(user);
        seed.RefreshTokens.Add(original);
        await seed.SaveChangesAsync();

        using var cancellation = new CancellationTokenSource();
        var fault = new RejectSuccessorInsert(cancel ? cancellation : null);
        var options = new DbContextOptionsBuilder<AuthDbContext>(database.Options<AuthDbContext>())
            .AddInterceptors(fault)
            .Options;
        await using var context = CreateContext(options);
        using var unit = new AuthUnitOfWork(context);
        var stamp = new Mock<ISecurityStampService>();
        var handler = CreateRefreshHandler(unit, stamp.Object);
        var request = new RefreshTokenCommand { RefreshToken = PresentedToken };
        if (cancel)
        {
            await Assert.ThrowsAnyAsync<OperationCanceledException>(() => handler.Handle(request, cancellation.Token));
        }
        else
        {
            var result = await handler.Handle(request, cancellation.Token);
            Assert.True(result.IsFailure);
            Assert.Equal("REFRESH_ERROR", result.Error?.Code);
        }

        Assert.True(fault.ConsumedBeforeInsert);
        Assert.True(fault.InsertRejected);
        stamp.Verify(x => x.SetStampAsync(It.IsAny<Guid>(), It.IsAny<CancellationToken>()), Times.Never);
        await using var verify = CreateContext(database.Options<AuthDbContext>());
        var retained = Assert.Single(await verify.RefreshTokens.AsNoTracking().ToListAsync());
        Assert.Equal(original.Id, retained.Id);
        Assert.True(retained.IsActive);
        Assert.True(retained.Matches(PresentedToken));
    }

    private static LoginCommand LoginRequest(User user) => new()
    {
        Email = user.Email.Value,
        Password = "synthetic-audit-input",
        RememberMe = true
    };

    private static LoginCommandHandler CreateLoginHandler(IAuthUnitOfWork unit)
    {
        var passwordHasher = new Mock<IPasswordHasher>();
        passwordHasher.Setup(x => x.VerifyPassword(It.IsAny<string>(), It.IsAny<string>())).Returns(true);
        return new LoginCommandHandler(unit, passwordHasher.Object, CreateTokenService(),
            Mock.Of<ITwoFactorService>(), Mock.Of<IRecoveryCodeService>(), CurrentRequest(),
            Mock.Of<IBusinessEventLogger>(), NullLogger<LoginCommandHandler>.Instance);
    }

    private static RefreshTokenCommandHandler CreateRefreshHandler(IAuthUnitOfWork unit, ISecurityStampService stamp) =>
        new(unit, CreateTokenService(), CurrentRequest(), stamp, NullLogger<RefreshTokenCommandHandler>.Instance);

    private static AuthDbContext CreateContext(DbContextOptions<AuthDbContext> options) =>
        new(options, Mock.Of<IDomainEventDispatcher>());

    private static User CreateUser() =>
        User.Create(Email.Create("audit@example.test"), "synthetic-hash", "Audit", "Test");

    private static RefreshToken CreateToken(Guid user, string value, string? fingerprint) =>
        new(user, value, Ip, DateTime.UtcNow.AddDays(1), true, fingerprint, Agent);

    private static string DeviceFingerprint() =>
        Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes($"{Agent}|{Ip}")));

    private static ITokenService CreateTokenService()
    {
        var tokens = new Mock<ITokenService>();
        tokens.Setup(x => x.GenerateAccessToken(It.IsAny<User>())).Returns("synthetic-access");
        tokens.Setup(x => x.GenerateRefreshToken()).Returns(() => Guid.NewGuid().ToString("N"));
        tokens.Setup(x => x.GetRefreshTokenLifetime()).Returns(TimeSpan.FromDays(7));
        return tokens.Object;
    }

    private static ICurrentUserService CurrentRequest()
    {
        var request = new Mock<ICurrentUserService>();
        request.SetupGet(x => x.IpAddress).Returns(Ip);
        request.SetupGet(x => x.UserAgent).Returns(Agent);
        return request.Object;
    }

    private sealed class SessionReadBarrier(Func<string, bool> isTargetRead) : DbCommandInterceptor
    {
        private readonly TaskCompletionSource _reads = new(TaskCreationOptions.RunContinuationsAsynchronously);
        private int _count;

        public bool BothReadsReached => _reads.Task.IsCompletedSuccessfully;

        public override async ValueTask<DbDataReader> ReaderExecutedAsync(
            DbCommand command, CommandExecutedEventData eventData, DbDataReader result,
            CancellationToken cancellationToken = default)
        {
            if (command.CommandText.StartsWith("SELECT", StringComparison.Ordinal) && isTargetRead(command.CommandText))
            {
                if (Interlocked.Increment(ref _count) == 2)
                    _reads.TrySetResult();

                await _reads.Task.WaitAsync(TimeSpan.FromSeconds(10), cancellationToken);
            }

            return result;
        }
    }

    private sealed class RejectSuccessorInsert(CancellationTokenSource? cancellation) : DbCommandInterceptor
    {
        public bool ConsumedBeforeInsert { get; private set; }
        public bool InsertRejected { get; private set; }

        public override ValueTask<int> NonQueryExecutedAsync(
            DbCommand command, CommandExecutedEventData eventData, int result,
            CancellationToken cancellationToken = default)
        {
            if (command.CommandText.StartsWith("UPDATE \"RefreshTokens\"", StringComparison.Ordinal) && result == 1)
                ConsumedBeforeInsert = true;
            return ValueTask.FromResult(result);
        }

        public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(
            DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result,
            CancellationToken cancellationToken = default)
        {
            if (command.CommandText.Contains("INSERT INTO \"RefreshTokens\"", StringComparison.Ordinal))
            {
                InsertRejected = true;
                cancellation?.Cancel();
                cancellationToken.ThrowIfCancellationRequested();
                throw new InvalidOperationException("Synthetic successor insert rejection");
            }

            return ValueTask.FromResult(result);
        }
    }

    private sealed class ReplayReadGate : DbCommandInterceptor
    {
        public TaskCompletionSource ReadObserved { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource Resume { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);

        public override async ValueTask<DbDataReader> ReaderExecutedAsync(
            DbCommand command, CommandExecutedEventData eventData, DbDataReader result,
            CancellationToken cancellationToken = default)
        {
            if (command.CommandText.StartsWith("SELECT", StringComparison.Ordinal) &&
                command.CommandText.Contains("\"RefreshTokens\"", StringComparison.Ordinal) &&
                ReadObserved.TrySetResult())
            {
                await Resume.Task.WaitAsync(TimeSpan.FromSeconds(15), cancellationToken);
            }

            return result;
        }
    }

    private sealed class RotationWriteGate : DbCommandInterceptor
    {
        public TaskCompletionSource Consumed { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource Resume { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);

        public override async ValueTask<int> NonQueryExecutedAsync(
            DbCommand command, CommandExecutedEventData eventData, int result,
            CancellationToken cancellationToken = default)
        {
            if (command.CommandText.StartsWith("UPDATE \"RefreshTokens\"", StringComparison.Ordinal) &&
                result == 1 && Consumed.TrySetResult())
            {
                await Resume.Task.WaitAsync(TimeSpan.FromSeconds(20), cancellationToken);
            }

            return result;
        }
    }

    private sealed class ReplayLockProbe : DbCommandInterceptor
    {
        public TaskCompletionSource<int> BackendPid { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);

        public override ValueTask<InterceptionResult<int>> NonQueryExecutingAsync(
            DbCommand command, CommandEventData eventData, InterceptionResult<int> result,
            CancellationToken cancellationToken = default)
        {
            if (command.CommandText.Contains("pg_advisory_xact_lock", StringComparison.Ordinal) &&
                command.Connection is NpgsqlConnection connection)
            {
                BackendPid.TrySetResult(connection.ProcessID);
            }

            return ValueTask.FromResult(result);
        }
    }
}
