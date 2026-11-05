using System.Data.Common;
using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Planora.Auth.Application.Common.Interfaces;
using Planora.Auth.Application.Features.Authentication.Commands.Login;
using Planora.Auth.Application.Features.Authentication.Commands.Logout;
using Planora.Auth.Application.Features.Authentication.Handlers.Login;
using Planora.Auth.Application.Features.Authentication.Handlers.Logout;
using Planora.Auth.Application.Features.Users.Commands.RevokeSession;
using Planora.Auth.Application.Features.Users.Handlers.RevokeSession;
using Planora.Auth.Domain.Entities;
using Planora.Auth.Domain.ValueObjects;
using Planora.Auth.Infrastructure.Persistence;
using Planora.Auth.Infrastructure.Persistence.Repositories;
using Planora.BuildingBlocks.Application.Messaging;
using Planora.BuildingBlocks.Application.Services;
using Planora.UnitTests.BuildingBlocks.Retention.Postgres;

namespace Planora.UnitTests.Services.AuthApi.Infrastructure;

public sealed class AuthSingleSessionRevocationPostgresTests
{
    private const string OldToken = "synthetic-old-refresh-generation";
    private const string NewToken = "synthetic-new-refresh-generation";
    private const string OtherToken = "synthetic-other-owner-refresh";
    private const string Password = "synthetic-login-password";
    private const string PasswordHash = "synthetic-login-hash";
    private const string IpAddress = "192.0.2.21";
    private const string UserAgent = "Audit Browser";

    [PostgresFact]
    public Task LogoutAsync_StaleGenerationDoesNotOverwriteOrRevokeSameDeviceRelogin() =>
        CheckStaleGenerationAsync(logoutByToken: true);

    [PostgresFact]
    public Task RevokeOneAsync_StaleGenerationDoesNotOverwriteOrRevokeSameDeviceRelogin() =>
        CheckStaleGenerationAsync(logoutByToken: false);

    private static async Task CheckStaleGenerationAsync(bool logoutByToken)
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        var fixture = await SeedAsync(database, timeout.Token);
        var before = await ReadSessionAsync(database, fixture.OwnerSessionId, timeout.Token);
        Assert.True(before.Matches(OldToken));
        var gate = new LogoutReadGate(before.Id, before.Token);
        var logoutOptions = new DbContextOptionsBuilder<AuthDbContext>(database.Options<AuthDbContext>())
            .AddInterceptors(gate)
            .Options;
        await using var logoutContext = CreateContext(logoutOptions);
        using var logoutUnit = new AuthUnitOfWork(logoutContext);
        var logout = new LogoutCommandHandler(logoutUnit, CurrentUser(fixture.Owner.Id),
            NullLogger<LogoutCommandHandler>.Instance);
        var loggingOut = logoutByToken
            ? logout.Handle(new LogoutCommand { RefreshToken = OldToken }, timeout.Token)
            : new RevokeSessionCommandHandler(logoutUnit, CurrentUser(fixture.Owner.Id),
                NullLogger<RevokeSessionCommandHandler>.Instance)
                .Handle(new RevokeSessionCommand { TokenId = fixture.OwnerSessionId }, timeout.Token);

        RefreshToken replacement;
        try
        {
            await gate.ReadObserved.Task.WaitAsync(TimeSpan.FromSeconds(10), timeout.Token);
            await using var loginContext = CreateContext(database.Options<AuthDbContext>());
            using var loginUnit = new AuthUnitOfWork(loginContext);
            var passwordHasher = new Mock<IPasswordHasher>();
            passwordHasher.Setup(x => x.VerifyPassword(Password, PasswordHash)).Returns(true);
            var tokens = new Mock<ITokenService>();
            tokens.Setup(x => x.GenerateAccessToken(It.IsAny<User>())).Returns("synthetic-access-token");
            tokens.Setup(x => x.GenerateRefreshToken()).Returns(NewToken);
            var login = new LoginCommandHandler(loginUnit, passwordHasher.Object, tokens.Object,
                Mock.Of<ITwoFactorService>(), Mock.Of<IRecoveryCodeService>(), CurrentUser(fixture.Owner.Id),
                Mock.Of<IBusinessEventLogger>(), NullLogger<LoginCommandHandler>.Instance);
            var loggedIn = await login.Handle(new LoginCommand
            {
                Email = fixture.Owner.Email.Value,
                Password = Password,
                RememberMe = true
            }, timeout.Token);

            Assert.True(loggedIn.IsSuccess);
            replacement = await ReadSessionAsync(database, fixture.OwnerSessionId, timeout.Token);
            Assert.True(replacement.IsActive);
            Assert.True(replacement.Matches(loggedIn.Value!.RefreshToken));
            Assert.False(replacement.Matches(OldToken));
            Assert.True(replacement.RememberMe);
            Assert.Equal(before.LoginCount + 1, replacement.LoginCount);
            Assert.True(replacement.LastLoginAt > before.LastLoginAt);
        }
        finally
        {
            gate.Resume.TrySetResult();
            await loggingOut;
        }

        var result = await loggingOut;
        if (logoutByToken)
            Assert.True(result.IsSuccess);
        else
            Assert.Equal("SESSION_INACTIVE", result.Error?.Code);
        var persisted = await ReadSessionAsync(database, fixture.OwnerSessionId, timeout.Token);
        Assert.True(persisted.IsActive, "Logout of an older token generation revoked the replacement session.");
        AssertSameSession(replacement, persisted);
    }

    [PostgresFact]
    public async Task RevokeAsync_CancellationPreservesStateAndSuccessfulRetryChangesOnlyRevocation()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        var fixture = await SeedAsync(database, timeout.Token);
        var before = await ReadSessionAsync(database, fixture.OwnerSessionId, timeout.Token);
        await using var context = CreateContext(database.Options<AuthDbContext>());
        var repository = new RefreshTokenRepository(context);
        using var cancelled = new CancellationTokenSource();
        cancelled.Cancel();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            repository.TryRevokeAsync(before, IpAddress, "Logged out", cancelled.Token));
        AssertSameSession(before, await ReadSessionAsync(database, before.Id, timeout.Token));
        Assert.True(await repository.TryRevokeAsync(before, IpAddress, "Logged out", timeout.Token));

        var saved = await ReadSessionAsync(database, before.Id, timeout.Token);
        Assert.True(saved.IsRevoked);
        Assert.Equal((before.Token, before.LoginCount, before.LastLoginAt, before.RememberMe),
            (saved.Token, saved.LoginCount, saved.LastLoginAt, saved.RememberMe));
        Assert.Equal(("Logged out", IpAddress), (saved.RevokedReason, saved.RevokedByIp));
        Assert.False(await repository.TryRevokeAsync(before, IpAddress, "Revoked by user", timeout.Token));
        AssertSameSession(saved, await ReadSessionAsync(database, before.Id, timeout.Token));
    }

    [PostgresFact]
    public async Task LogoutAndRevokeOneAsync_ForeignSessionRemainsUnchanged()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        var fixture = await SeedAsync(database, timeout.Token);
        var ownerBefore = await ReadSessionAsync(database, fixture.OwnerSessionId, timeout.Token);
        var otherBefore = await ReadSessionAsync(database, fixture.OtherSessionId, timeout.Token);
        var otherCaller = CurrentUser(otherBefore.UserId);
        Assert.True(ownerBefore.IsActive);
        Assert.True(otherBefore.IsActive);

        await using (var logoutContext = CreateContext(database.Options<AuthDbContext>()))
        {
            using var unit = new AuthUnitOfWork(logoutContext);
            var logout = new LogoutCommandHandler(unit, otherCaller, NullLogger<LogoutCommandHandler>.Instance);
            Assert.True((await logout.Handle(new LogoutCommand { RefreshToken = OldToken }, timeout.Token)).IsSuccess);
        }
        AssertSameSession(ownerBefore, await ReadSessionAsync(database, fixture.OwnerSessionId, timeout.Token));
        AssertSameSession(otherBefore, await ReadSessionAsync(database, fixture.OtherSessionId, timeout.Token));

        await using (var revokeContext = CreateContext(database.Options<AuthDbContext>()))
        {
            using var unit = new AuthUnitOfWork(revokeContext);
            var revoke = new RevokeSessionCommandHandler(unit, otherCaller, NullLogger<RevokeSessionCommandHandler>.Instance);
            var denied = await revoke.Handle(new RevokeSessionCommand { TokenId = fixture.OwnerSessionId }, timeout.Token);
            Assert.True(denied.IsFailure);
            Assert.Equal("ACCESS_DENIED", denied.Error?.Code);
        }
        AssertSameSession(ownerBefore, await ReadSessionAsync(database, fixture.OwnerSessionId, timeout.Token));
        AssertSameSession(otherBefore, await ReadSessionAsync(database, fixture.OtherSessionId, timeout.Token));
    }

    private static async Task<SessionFixture> SeedAsync(TemporaryDatabase database, CancellationToken token)
    {
        await using var context = CreateContext(database.Options<AuthDbContext>());
        await AuthDatabaseStartup.EnsureReadyAsync(context, NullLogger.Instance);
        var owner = User.Create(Email.Create("audit-single-session-owner@example.test"), PasswordHash, "Audit", "Owner");
        var other = User.Create(Email.Create("audit-single-session-other@example.test"), PasswordHash, "Audit", "Other");
        var fingerprint = Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes($"{UserAgent}|{IpAddress}")));
        var expires = DateTime.UtcNow.AddDays(1);
        var oldSession = new RefreshToken(owner.Id, OldToken, IpAddress, expires, false, fingerprint, "Original device");
        RetentionTestKit.Set(oldSession, nameof(RefreshToken.LastLoginAt), DateTime.UtcNow.AddHours(-1));
        var otherSession = new RefreshToken(other.Id, OtherToken, IpAddress, expires, false, fingerprint, "Other device");
        context.Users.AddRange(owner, other);
        context.RefreshTokens.AddRange(oldSession, otherSession);
        await context.SaveChangesAsync(token);
        return new SessionFixture(owner, oldSession.Id, otherSession.Id);
    }

    private static async Task<RefreshToken> ReadSessionAsync(
        TemporaryDatabase database, Guid sessionId, CancellationToken token)
    {
        await using var context = CreateContext(database.Options<AuthDbContext>());
        return await context.RefreshTokens.AsNoTracking().SingleAsync(row => row.Id == sessionId, token);
    }

    private static void AssertSameSession(RefreshToken expected, RefreshToken persisted)
    {
        Assert.Equal((expected.Id, expected.UserId, expected.Token, expected.DeviceFingerprint, expected.DeviceName),
            (persisted.Id, persisted.UserId, persisted.Token, persisted.DeviceFingerprint, persisted.DeviceName));
        Assert.Equal((expected.ExpiresAt, expected.LastLoginAt, expected.LoginCount, expected.RememberMe, expected.CreatedByIp),
            (persisted.ExpiresAt, persisted.LastLoginAt, persisted.LoginCount, persisted.RememberMe, persisted.CreatedByIp));
        Assert.Equal((expected.RevokedAt, expected.RevokedReason, expected.RevokedByIp, expected.ReplacedByToken),
            (persisted.RevokedAt, persisted.RevokedReason, persisted.RevokedByIp, persisted.ReplacedByToken));
    }

    private static ICurrentUserService CurrentUser(Guid userId) =>
        Mock.Of<ICurrentUserService>(x => x.UserId == userId && x.IpAddress == IpAddress && x.UserAgent == UserAgent);

    private static AuthDbContext CreateContext(DbContextOptions<AuthDbContext> options) =>
        new(options, Mock.Of<IDomainEventDispatcher>());

    private sealed record SessionFixture(User Owner, Guid OwnerSessionId, Guid OtherSessionId);

    private sealed class LogoutReadGate(Guid sessionId, string oldTokenHash) : DbCommandInterceptor
    {
        public TaskCompletionSource ReadObserved { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource Resume { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);

        public override async ValueTask<DbDataReader> ReaderExecutedAsync(
            DbCommand command, CommandExecutedEventData eventData, DbDataReader result,
            CancellationToken cancellationToken = default)
        {
            if (command.CommandText.StartsWith("SELECT", StringComparison.Ordinal) &&
                command.CommandText.Contains("\"RefreshTokens\"", StringComparison.Ordinal) &&
                command.Parameters.Cast<DbParameter>().Any(parameter =>
                    parameter.Value is string hash && hash == oldTokenHash ||
                    parameter.Value is Guid id && id == sessionId) &&
                ReadObserved.TrySetResult())
            {
                await Resume.Task.WaitAsync(cancellationToken);
            }

            return result;
        }
    }
}
