using System.Data.Common;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Moq;
using System.Text.Json;
using Planora.Auth.Application.Common.Interfaces;
using Planora.Auth.Application.Common.Options;
using Planora.Auth.Application.Features.Authentication.Commands.RefreshToken;
using Planora.Auth.Application.Features.Authentication.Commands.ResetPassword;
using Planora.Auth.Application.Features.Authentication.Handlers.RefreshToken;
using Planora.Auth.Application.Features.Authentication.Handlers.ResetPassword;
using Planora.Auth.Application.Features.Users.Commands.ChangePassword;
using Planora.Auth.Application.Features.Users.Commands.ChangeEmail;
using Planora.Auth.Application.Features.Users.Commands.DeleteUser;
using Planora.Auth.Application.Features.Users.Commands.Disable2FA;
using Planora.Auth.Application.Features.Users.Commands.RevokeAllSessions;
using Planora.Auth.Application.Features.Users.Handlers.ChangePassword;
using Planora.Auth.Application.Features.Users.Handlers.ChangeEmail;
using Planora.Auth.Application.Features.Users.Handlers.DeleteUser;
using Planora.Auth.Application.Features.Users.Handlers.Disable2FA;
using Planora.Auth.Application.Features.Users.Handlers.RevokeSessions;
using Planora.Auth.Domain.Entities;
using Planora.Auth.Domain.Repositories;
using Planora.Auth.Domain.ValueObjects;
using Planora.Auth.Infrastructure.Persistence;
using Planora.Auth.Infrastructure.Services.Authentication;
using Planora.BuildingBlocks.Application.Messaging;
using Planora.BuildingBlocks.Application.Messaging.Events;
using Planora.BuildingBlocks.Application.Outbox;
using Planora.BuildingBlocks.Application.Services;
using Planora.UnitTests.BuildingBlocks.Retention.Postgres;

namespace Planora.UnitTests.Services.AuthApi.Infrastructure;

public sealed class AuthSecurityStampCommitPostgresTests
{
    private const string CurrentPassword = "Audit-Original-Stamp-29!";
    private const string NewPassword = "Audit-Replacement-Stamp-47!";
    private const string ReplayedToken = "synthetic-stamp-replayed-refresh";
    private readonly PasswordHasher _hasher = new();
    private readonly PasswordResetTokenService _resetTokens = new(new ConfigurationBuilder().Build());

    [PostgresFact]
    public Task ResetAsync_StampWriteFailureDoesNotCommitCredentialsOrSessions() => CheckStampFailureAsync("reset");

    [PostgresFact]
    public Task ChangeAsync_StampWriteFailureDoesNotCommitCredentialsOrSessions() => CheckStampFailureAsync("change");

    [PostgresFact]
    public Task RevokeAllAsync_StampWriteFailureDoesNotCommitSessions() => CheckStampFailureAsync("revoke");

    [PostgresFact]
    public Task ReplayAsync_StampWriteFailureDoesNotCommitSessionRevocation() => CheckStampFailureAsync("replay");

    [PostgresFact]
    public Task ChangeEmailAsync_StampWriteFailureDoesNotCommitIdentity() => CheckStampFailureAsync("email");

    [PostgresFact]
    public Task Disable2FAAsync_StampWriteFailureDoesNotCommitSecurityFlags() => CheckStampFailureAsync("disable");

    [PostgresFact]
    public Task DeleteAsync_StampWriteFailureDoesNotCommitDeletionOrCleanupEvent() => CheckStampFailureAsync("delete");

    [PostgresFact]
    public Task ChangeEmailAsync_CommitsOnlyAfterStampAndPreservesCurrentCredential() => CheckIdentityMutationAsync("email", stale: false);

    [PostgresFact]
    public Task Disable2FAAsync_CommitsOnlyAfterStampAndPreservesCurrentCredential() => CheckIdentityMutationAsync("disable", stale: false);

    [PostgresFact]
    public Task DeleteAsync_CommitsCleanupEventAndRevocationOnlyAfterStamp() => CheckIdentityMutationAsync("delete", stale: false);

    [PostgresFact]
    public Task ChangeEmailAsync_RejectsPasswordChangedSinceVerification() => CheckIdentityMutationAsync("email", stale: true);

    [PostgresFact]
    public Task Disable2FAAsync_RejectsPasswordChangedSinceVerification() => CheckIdentityMutationAsync("disable", stale: true);

    [PostgresFact]
    public Task DeleteAsync_RejectsPasswordChangedSinceVerificationWithoutCleanup() => CheckIdentityMutationAsync("delete", stale: true);

    [PostgresFact]
    public Task ResetAsync_CallbackCancellationRollsBackSql() => CheckInterruptedCommitAsync(replay: false, cancel: true);

    [PostgresFact]
    public Task ReplayAsync_CallbackCancellationRollsBackSql() => CheckInterruptedCommitAsync(replay: true, cancel: true);

    [PostgresFact]
    public Task ResetAsync_CommitFailureRollsBackSqlAfterConservativeStamp() => CheckInterruptedCommitAsync(replay: false, cancel: false);

    [PostgresFact]
    public Task ReplayAsync_CommitFailureRollsBackSqlAfterConservativeStamp() => CheckInterruptedCommitAsync(replay: true, cancel: false);

    [PostgresFact]
    public Task DeleteAsync_CommitFailureRollsBackDeletionAndOutboxAfterConservativeStamp() =>
        CheckInterruptedCommitAsync(replay: false, cancel: false, delete: true);

    private async Task CheckStampFailureAsync(string operation)
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        var resetValue = _resetTokens.GenerateToken();
        var resetHash = _resetTokens.HashToken(resetValue);
        var user = await SeedAsync(database, resetHash, timeout.Token);
        await using var context = CreateContext(database);
        using var unit = new AuthUnitOfWork(context);
        var stamp = new Mock<ISecurityStampService>();
        stamp.Setup(x => x.SetStampAsync(user.Id, It.IsAny<CancellationToken>()))
            .Returns(async (Guid _, CancellationToken token) =>
            {
                Assert.NotNull(context.Database.CurrentTransaction);
                Assert.True(await context.Database.SqlQuery<bool>($"""
                    SELECT EXISTS (
                        SELECT 1 FROM pg_catalog.pg_locks
                        WHERE pid = pg_backend_pid() AND locktype = 'advisory' AND granted
                    ) AS "Value"
                    """).SingleAsync(token));
                await AssertUnchangedAsync(database, user, resetHash, token);
                throw new InvalidOperationException("Synthetic stamp write failure");
            });
        var email = new Mock<IEmailService>();
        var avatar = new Mock<IAvatarStorage>();
        var current = Mock.Of<ICurrentUserService>(x => x.UserId == user.Id && x.IpAddress == "192.0.2.42");
        var validator = new Mock<IPasswordValidator>();
        validator.Setup(x => x.IsStrongPassword(NewPassword)).Returns(true);
        validator.Setup(x => x.IsPasswordCompromisedAsync(NewPassword, It.IsAny<CancellationToken>())).ReturnsAsync(false);
        validator.Setup(x => x.IsDifferentFromPreviousPasswordsAsync(user.Id, NewPassword, 5, It.IsAny<CancellationToken>()))
            .ReturnsAsync(true);

        switch (operation)
        {
            case "reset":
                var reset = new ResetPasswordCommandHandler(unit, _hasher, validator.Object, _resetTokens,
                    email.Object, stamp.Object, NullLogger<ResetPasswordCommandHandler>.Instance);
                Assert.Equal("RESET_PASSWORD_ERROR", (await reset.Handle(new ResetPasswordCommand
                {
                    ResetToken = resetValue, NewPassword = NewPassword, ConfirmPassword = NewPassword
                }, timeout.Token)).Error?.Code);
                break;
            case "change":
                var change = new ChangePasswordCommandHandler(unit, _hasher, validator.Object, current,
                    email.Object, stamp.Object, NullLogger<ChangePasswordCommandHandler>.Instance);
                await Assert.ThrowsAsync<InvalidOperationException>(() => change.Handle(new ChangePasswordCommand
                {
                    CurrentPassword = CurrentPassword, NewPassword = NewPassword, ConfirmNewPassword = NewPassword
                }, timeout.Token));
                break;
            case "revoke":
                var revoke = new RevokeAllSessionsCommandHandler(unit, _hasher, current, stamp.Object,
                    NullLogger<RevokeAllSessionsCommandHandler>.Instance);
                Assert.Equal("REVOKE_ALL_ERROR", (await revoke.Handle(
                    new RevokeAllSessionsCommand { Password = CurrentPassword }, timeout.Token)).Error?.Code);
                break;
            case "replay":
                var replay = new RefreshTokenCommandHandler(unit, Mock.Of<ITokenService>(), current, stamp.Object,
                    NullLogger<RefreshTokenCommandHandler>.Instance);
                Assert.Equal("REFRESH_ERROR", (await replay.Handle(
                    new RefreshTokenCommand { RefreshToken = ReplayedToken }, timeout.Token)).Error?.Code);
                break;
            case "email":
                var changeEmail = new ChangeEmailCommandHandler(unit, _hasher, current, email.Object, stamp.Object,
                    Options.Create(new FrontendOptions { BaseUrl = "https://app.example.test" }),
                    NullLogger<ChangeEmailCommandHandler>.Instance);
                await Assert.ThrowsAsync<InvalidOperationException>(() => changeEmail.Handle(
                    new ChangeEmailCommand { Password = CurrentPassword, NewEmail = "replacement-stamp@example.test" }, timeout.Token));
                break;
            case "disable":
                var disable = new Disable2FACommandHandler(unit, _hasher, current, stamp.Object,
                    NullLogger<Disable2FACommandHandler>.Instance);
                Assert.Equal("DISABLE_2FA_ERROR", (await disable.Handle(
                    new Disable2FACommand { Password = CurrentPassword }, timeout.Token)).Error?.Code);
                break;
            case "delete":
                var delete = new DeleteUserCommandHandler(unit, _hasher, current,
                    new Planora.BuildingBlocks.Infrastructure.Persistence.OutboxRepository<AuthDbContext>(context),
                    stamp.Object, avatar.Object, NullLogger<DeleteUserCommandHandler>.Instance);
                await Assert.ThrowsAsync<InvalidOperationException>(() => delete.Handle(
                    new DeleteUserCommand { Password = CurrentPassword }, timeout.Token));
                break;
            default:
                throw new ArgumentOutOfRangeException(nameof(operation));
        }

        stamp.Verify(x => x.SetStampAsync(user.Id, It.IsAny<CancellationToken>()), Times.Once);
        email.VerifyNoOtherCalls();
        await AssertUnchangedAsync(database, user, resetHash, timeout.Token);
        avatar.VerifyNoOtherCalls();
    }

    private async Task CheckIdentityMutationAsync(string operation, bool stale)
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        const string resetHash = "synthetic-identity-reset-hash";
        var user = await SeedAsync(database, resetHash, timeout.Token);
        const string interveningHash = "synthetic-intervening-password-hash";
        if (stale)
        {
            await using var competing = CreateContext(database);
            await competing.Users.Where(row => row.Id == user.Id)
                .ExecuteUpdateAsync(update => update.SetProperty(row => row.PasswordHash, interveningHash), timeout.Token);
        }
        await using var context = CreateContext(database);
        using var unit = new AuthUnitOfWork(context);
        var stampCalls = 0;
        async Task BeforeCommit(CancellationToken token)
        {
            stampCalls++;
            Assert.NotNull(context.Database.CurrentTransaction);
            await AssertUnchangedAsync(database, user, resetHash, token);
        }

        var result = await MutateIdentityAsync(unit, context, user, operation, BeforeCommit, timeout.Token);
        Assert.Equal(stale ? 0 : 1, stampCalls);
        await using var verify = CreateContext(database);
        var persisted = await verify.Users.IgnoreQueryFilters().AsNoTracking().Include(row => row.RefreshTokens)
            .SingleAsync(row => row.Id == user.Id, timeout.Token);
        Assert.Equal(stale ? interveningHash : user.PasswordHash, persisted.PasswordHash);
        if (stale)
        {
            Assert.Null(result);
            Assert.Equal(user.Email, persisted.Email);
            Assert.True(persisted.TwoFactorEnabled);
            Assert.False(persisted.IsDeleted);
            Assert.Empty(await verify.OutboxMessages.ToListAsync(timeout.Token));
            return;
        }

        Assert.NotNull(result);
        switch (operation)
        {
            case "email":
                Assert.Equal("replacement-stamp@example.test", persisted.Email.Value);
                Assert.Equal("synthetic-new-verification-hash", persisted.EmailVerificationToken);
                Assert.True(persisted.EmailVerificationTokenExpiry > DateTime.UtcNow);
                Assert.False(persisted.IsEmailVerified);
                Assert.True(persisted.TwoFactorEnabled);
                break;
            case "disable":
                Assert.False(persisted.TwoFactorEnabled);
                Assert.False(persisted.IsTwoFactorEnabled);
                Assert.Null(persisted.TwoFactorSecret);
                Assert.Equal(user.Email, persisted.Email);
                break;
            case "delete":
                Assert.True(persisted.IsDeleted);
                Assert.False(persisted.IsActive);
                Assert.All(persisted.RefreshTokens, row => Assert.True(row.IsRevoked));
                var message = Assert.Single(await verify.OutboxMessages.ToListAsync(timeout.Token));
                Assert.Equal(typeof(UserDeletedIntegrationEvent).AssemblyQualifiedName, message.Type);
                Assert.Equal(user.Id, JsonSerializer.Deserialize<UserDeletedIntegrationEvent>(message.Content)!.UserId);
                break;
        }
    }

    private static Task<User?> MutateIdentityAsync(IAuthUnitOfWork unit, AuthDbContext context, User user,
        string operation, Func<CancellationToken, Task> beforeCommit, CancellationToken token) => operation switch
    {
        "email" => unit.TryChangeEmailAsync(user.Id, user.PasswordHash, Email.Create("replacement-stamp@example.test"),
            "synthetic-new-verification-hash", DateTime.UtcNow.AddHours(1), beforeCommit, token),
        "disable" => unit.TryDisableTwoFactorAsync(user.Id, user.PasswordHash, beforeCommit, token),
        "delete" => unit.TryDeleteUserAsync(user.Id, user.PasswordHash,
            (owner, stageToken) => StageDeletionAsync(context, owner, stageToken), beforeCommit, token),
        _ => throw new ArgumentOutOfRangeException(nameof(operation))
    };

    private static Task StageDeletionAsync(AuthDbContext context, User owner, CancellationToken token) =>
        new Planora.BuildingBlocks.Infrastructure.Persistence.OutboxRepository<AuthDbContext>(context).StageAsync(
            new OutboxMessage(typeof(UserDeletedIntegrationEvent).AssemblyQualifiedName!,
                JsonSerializer.Serialize(new UserDeletedIntegrationEvent(owner.Id, owner.Email.Value)), DateTime.UtcNow), token);

    private async Task CheckInterruptedCommitAsync(bool replay, bool cancel, bool delete = false)
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        using var request = CancellationTokenSource.CreateLinkedTokenSource(timeout.Token);
        const string resetHash = "synthetic-interrupted-reset-hash";
        var user = await SeedAsync(database, resetHash, timeout.Token);
        var options = new DbContextOptionsBuilder<AuthDbContext>(database.Options<AuthDbContext>());
        if (!cancel)
            options.AddInterceptors(new CommitFailure());
        await using var context = new AuthDbContext(options.Options, Mock.Of<IDomainEventDispatcher>());
        using var unit = new AuthUnitOfWork(context);
        var calls = 0;
        Task BeforeCommit(CancellationToken token)
        {
            Assert.NotNull(context.Database.CurrentTransaction);
            calls++;
            if (cancel)
            {
                request.Cancel();
                token.ThrowIfCancellationRequested();
            }
            return Task.CompletedTask;
        }

        Task MutateAsync() => delete
            ? MutateIdentityAsync(unit, context, user, "delete", BeforeCommit, request.Token)
            : replay
            ? unit.RefreshTokens.RevokeActiveAfterReplayAsync(user.Id, "192.0.2.42", "Replay", BeforeCommit, request.Token)
            : unit.TryResetPasswordAsync(user.Id, resetHash, "synthetic-new-password-hash", BeforeCommit, request.Token);
        if (cancel)
            await Assert.ThrowsAnyAsync<OperationCanceledException>(MutateAsync);
        else
            await Assert.ThrowsAsync<InvalidOperationException>(MutateAsync);
        Assert.Equal(1, calls);
        await AssertUnchangedAsync(database, user, resetHash, timeout.Token);
    }

    private static async Task AssertUnchangedAsync(
        TemporaryDatabase database, User user, string resetHash, CancellationToken token)
    {
        await using var verify = CreateContext(database);
        var persisted = await verify.Users.IgnoreQueryFilters().AsNoTracking().Include(x => x.RefreshTokens)
            .SingleAsync(x => x.Id == user.Id, token);
        Assert.Equal(user.PasswordHash, persisted.PasswordHash);
        Assert.Equal(resetHash, persisted.PasswordResetToken);
        Assert.Equal(user.LastPasswordChangedAt, persisted.LastPasswordChangedAt);
        Assert.Equal(user.Email, persisted.Email);
        Assert.Equal(user.IsEmailVerified, persisted.IsEmailVerified);
        Assert.Equal(user.EmailVerificationToken, persisted.EmailVerificationToken);
        Assert.Equal(user.TwoFactorEnabled, persisted.TwoFactorEnabled);
        Assert.Equal(user.IsTwoFactorEnabled, persisted.IsTwoFactorEnabled);
        Assert.Equal(user.TwoFactorSecret, persisted.TwoFactorSecret);
        Assert.Equal(user.Status, persisted.Status);
        Assert.False(persisted.IsDeleted);
        Assert.Empty(await verify.OutboxMessages.AsNoTracking().ToListAsync(token));
        Assert.Empty(await verify.PasswordHistory.AsNoTracking().ToListAsync(token));
        Assert.True(Assert.Single(persisted.RefreshTokens, x => !x.Matches(ReplayedToken)).IsActive);
        Assert.Equal("Replaced by new token", Assert.Single(persisted.RefreshTokens,
            x => x.Matches(ReplayedToken)).RevokedReason);
    }

    private async Task<User> SeedAsync(TemporaryDatabase database, string resetHash, CancellationToken token)
    {
        await using var context = CreateContext(database);
        await AuthDatabaseStartup.EnsureReadyAsync(context, NullLogger.Instance);
        var user = User.Create(Email.Create("audit-stamp@example.test"), _hasher.HashPassword(CurrentPassword), "Audit", "Stamp");
        user.SetPasswordResetToken(resetHash, DateTime.UtcNow.AddHours(1));
        user.EnableTwoFactor("synthetic-stamp-totp");
        var replayed = new RefreshToken(user.Id, ReplayedToken, "192.0.2.42", DateTime.UtcNow.AddDays(1));
        replayed.Revoke("192.0.2.42", "Replaced by new token");
        context.Users.Add(user);
        context.RefreshTokens.AddRange(replayed,
            new RefreshToken(user.Id, "synthetic-stamp-active-refresh", "192.0.2.42", DateTime.UtcNow.AddDays(1)));
        await context.SaveChangesAsync(token);
        return await context.Users.AsNoTracking().SingleAsync(x => x.Id == user.Id, token);
    }

    private static AuthDbContext CreateContext(TemporaryDatabase database) =>
        new(database.Options<AuthDbContext>(), Mock.Of<IDomainEventDispatcher>());

    private sealed class CommitFailure : DbTransactionInterceptor
    {
        public override ValueTask<InterceptionResult> TransactionCommittingAsync(
            DbTransaction transaction, TransactionEventData eventData, InterceptionResult result,
            CancellationToken cancellationToken = default) =>
            throw new InvalidOperationException("Synthetic database commit failure after stamp write");
    }
}
