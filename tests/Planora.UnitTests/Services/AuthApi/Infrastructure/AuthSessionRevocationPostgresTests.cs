using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Planora.Auth.Application.Common.Interfaces;
using Planora.Auth.Application.Features.Users.Commands.ChangePassword;
using Planora.Auth.Application.Features.Users.Commands.RevokeAllSessions;
using Planora.Auth.Application.Features.Users.Handlers.ChangePassword;
using Planora.Auth.Application.Features.Users.Handlers.RevokeSessions;
using Planora.Auth.Domain.Entities;
using Planora.Auth.Domain.ValueObjects;
using Planora.Auth.Infrastructure.Persistence;
using Planora.Auth.Infrastructure.Services.Authentication;
using Planora.BuildingBlocks.Application.Messaging;
using Planora.UnitTests.BuildingBlocks.Retention.Postgres;

namespace Planora.UnitTests.Services.AuthApi.Infrastructure;

public sealed class AuthSessionRevocationPostgresTests
{
    private const string CurrentPassword = "Audit-Session-Original-27!";
    private const string NewPassword = "Audit-Session-Replacement-43!";
    private const string ClientIp = "192.0.2.42";
    private readonly PasswordHasher _hasher = new();

    [PostgresFact]
    public async Task ChangePasswordAsync_WritesStampBeforeCommittingPasswordHistoryAndSessions()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        var before = await SeedAsync(database, timeout.Token, historicalPasswords: 7);
        await using var context = CreateContext(database);
        using var unit = new AuthUnitOfWork(context);
        var validator = new Mock<IPasswordValidator>();
        validator.Setup(x => x.IsStrongPassword(NewPassword)).Returns(true);
        validator.Setup(x => x.IsPasswordCompromisedAsync(NewPassword, It.IsAny<CancellationToken>()))
            .ReturnsAsync(false);
        validator.Setup(x => x.IsDifferentFromPreviousPasswordsAsync(
                before.Owner.Id, NewPassword, 5, It.IsAny<CancellationToken>()))
            .ReturnsAsync(true);
        SessionSnapshot? atStamp = null;
        var stamp = new Mock<ISecurityStampService>();
        stamp.Setup(x => x.SetStampAsync(before.Owner.Id, It.IsAny<CancellationToken>()))
            .Returns(async (Guid userId, CancellationToken token) =>
            {
                atStamp = await ReadSnapshotAsync(database, userId, token);
            });
        var handler = new ChangePasswordCommandHandler(unit, _hasher, validator.Object,
            CurrentUser(before.Owner.Id), Mock.Of<IEmailService>(), stamp.Object,
            NullLogger<ChangePasswordCommandHandler>.Instance);

        var result = await handler.Handle(new ChangePasswordCommand
        {
            CurrentPassword = CurrentPassword,
            NewPassword = NewPassword,
            ConfirmNewPassword = NewPassword
        }, timeout.Token);

        Assert.True(result.IsSuccess);
        stamp.Verify(x => x.SetStampAsync(before.Owner.Id, It.IsAny<CancellationToken>()), Times.Once);
        Assert.NotNull(atStamp);
        Assert.Equal(before.Owner.PasswordHash, atStamp.Owner.PasswordHash);
        Assert.Equal(before.History.Count, atStamp.History.Count);
        Assert.Equal(2, atStamp.Sessions.Count(row => row.UserId == before.Owner.Id && row.IsActive));
        var persisted = await ReadSnapshotAsync(database, before.Owner.Id, timeout.Token);
        Assert.True(_hasher.VerifyPassword(NewPassword, persisted.Owner.PasswordHash));
        Assert.NotNull(persisted.Owner.LastPasswordChangedAt);
        Assert.Equal(5, persisted.History.Count);
        var retained = before.History.OrderByDescending(entry => entry.ChangedAt).Take(4)
            .Select(entry => entry.Id).ToHashSet();
        Assert.Equal(4, persisted.History.Count(entry => retained.Contains(entry.Id)));
        Assert.Equal(before.Owner.PasswordHash, Assert.Single(persisted.History,
            entry => !retained.Contains(entry.Id)).PasswordHash);
        AssertSessionsRevoked(before, persisted, "Password changed", "system");
    }

    [PostgresFact]
    public async Task RevokeAllSessionsAsync_WritesStampBeforeCommittingOwnersSessionRevocation()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        var before = await SeedAsync(database, timeout.Token);
        await using var context = CreateContext(database);
        using var unit = new AuthUnitOfWork(context);
        SessionSnapshot? atStamp = null;
        var stamp = new Mock<ISecurityStampService>();
        stamp.Setup(x => x.SetStampAsync(before.Owner.Id, It.IsAny<CancellationToken>()))
            .Returns(async (Guid userId, CancellationToken token) =>
            {
                atStamp = await ReadSnapshotAsync(database, userId, token);
            });
        var handler = new RevokeAllSessionsCommandHandler(unit, _hasher, CurrentUser(before.Owner.Id),
            stamp.Object, NullLogger<RevokeAllSessionsCommandHandler>.Instance);

        var result = await handler.Handle(new RevokeAllSessionsCommand { Password = CurrentPassword }, timeout.Token);

        Assert.True(result.IsSuccess);
        stamp.Verify(x => x.SetStampAsync(before.Owner.Id, It.IsAny<CancellationToken>()), Times.Once);
        Assert.NotNull(atStamp);
        Assert.Equal(2, atStamp.Sessions.Count(row => row.UserId == before.Owner.Id && row.IsActive));
        var persisted = await ReadSnapshotAsync(database, before.Owner.Id, timeout.Token);
        Assert.Equal(before.Owner.PasswordHash, persisted.Owner.PasswordHash);
        Assert.Equal(before.Owner.LastPasswordChangedAt, persisted.Owner.LastPasswordChangedAt);
        var originalHistory = Assert.Single(before.History);
        var unchangedHistory = Assert.Single(persisted.History);
        Assert.Equal((originalHistory.Id, originalHistory.PasswordHash, originalHistory.ChangedAt),
            (unchangedHistory.Id, unchangedHistory.PasswordHash, unchangedHistory.ChangedAt));
        AssertSessionsRevoked(before, persisted, "Revoked all tokens", ClientIp);
    }

    [PostgresFact]
    public async Task ChangePasswordAsync_DoesNotReplacePasswordResetAfterCredentialCheck()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        var before = await SeedAsync(database, timeout.Token);
        var userId = before.Owner.Id;
        const string resetTokenHash = "synthetic-session-reset-hash";
        const string resetPassword = "Audit-Reset-Independent-85!";
        await using (var issue = CreateContext(database))
        {
            var owner = await issue.Users.SingleAsync(row => row.Id == userId, timeout.Token);
            owner.SetPasswordResetToken(resetTokenHash, DateTime.UtcNow.AddHours(1));
            await issue.SaveChangesAsync(timeout.Token);
        }

        await using var context = CreateContext(database);
        using var unit = new AuthUnitOfWork(context);
        var reached = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var resume = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var validator = new Mock<IPasswordValidator>();
        validator.Setup(x => x.IsStrongPassword(NewPassword)).Returns(true);
        validator.Setup(x => x.IsPasswordCompromisedAsync(NewPassword, It.IsAny<CancellationToken>()))
            .Returns(async (string _, CancellationToken token) =>
            {
                reached.TrySetResult();
                await resume.Task.WaitAsync(token);
                return false;
            });
        validator.Setup(x => x.IsDifferentFromPreviousPasswordsAsync(
                userId, NewPassword, 5, It.IsAny<CancellationToken>()))
            .ReturnsAsync(true);
        var stamp = new Mock<ISecurityStampService>();
        var mail = new Mock<IEmailService>();
        var handler = new ChangePasswordCommandHandler(unit, _hasher, validator.Object,
            CurrentUser(userId), mail.Object, stamp.Object, NullLogger<ChangePasswordCommandHandler>.Instance);
        var changing = handler.Handle(new ChangePasswordCommand
        {
            CurrentPassword = CurrentPassword,
            NewPassword = NewPassword,
            ConfirmNewPassword = NewPassword
        }, timeout.Token);

        try
        {
            await reached.Task.WaitAsync(TimeSpan.FromSeconds(10), timeout.Token);
            await using var resetContext = CreateContext(database);
            using var reset = new AuthUnitOfWork(resetContext);
            Assert.NotNull(await reset.TryResetPasswordAsync(
                userId, resetTokenHash, _hasher.HashPassword(resetPassword), timeout.Token));
        }
        finally
        {
            resume.TrySetResult();
            await changing;
        }

        Assert.Equal("INVALID_PASSWORD", (await changing).Error?.Code);
        var persisted = await ReadSnapshotAsync(database, userId, timeout.Token);
        Assert.True(_hasher.VerifyPassword(resetPassword, persisted.Owner.PasswordHash));
        Assert.Equal(Assert.Single(before.History).Id, Assert.Single(persisted.History).Id);
        AssertSessionsRevoked(before, persisted, "Password changed", "system");
        stamp.VerifyNoOtherCalls();
        mail.VerifyNoOtherCalls();
    }

    private async Task<SessionSnapshot> SeedAsync(
        TemporaryDatabase database, CancellationToken token, int historicalPasswords = 1)
    {
        await using var context = CreateContext(database);
        await AuthDatabaseStartup.EnsureReadyAsync(context, NullLogger.Instance);
        var owner = User.Create(Email.Create("audit-session-owner@example.test"),
            _hasher.HashPassword(CurrentPassword), "Audit", "Owner");
        var other = User.Create(Email.Create("audit-session-other@example.test"),
            "synthetic-other-password-hash", "Audit", "Other");
        var expires = DateTime.UtcNow.AddDays(1);
        var historical = new RefreshToken(owner.Id, "synthetic-history", ClientIp, expires,
            false, "device-one", "Previous session");
        historical.Revoke(ClientIp, "Synthetic previous revocation");

        context.Users.AddRange(owner, other);
        context.RefreshTokens.AddRange(
            new RefreshToken(owner.Id, "synthetic-live-one", ClientIp, expires, false, "device-one", "First device"),
            new RefreshToken(owner.Id, "synthetic-live-two", ClientIp, expires, false, "device-two", "Second device"),
            historical,
            new RefreshToken(other.Id, "synthetic-other-live", ClientIp, expires, false, "device-one", "Other device"));
        for (var index = 0; index < historicalPasswords; index++)
        {
            var previous = new PasswordHistory(owner.Id, $"synthetic-previous-password-hash-{index}");
            RetentionTestKit.Set(previous, nameof(PasswordHistory.ChangedAt), DateTime.UtcNow.AddDays(-index - 1));
            context.PasswordHistory.Add(previous);
        }
        await context.SaveChangesAsync(token);
        return await ReadSnapshotAsync(database, owner.Id, token);
    }

    private static void AssertSessionsRevoked(
        SessionSnapshot before, SessionSnapshot after, string expectedReason, string expectedIp)
    {
        Assert.Equal(2, before.Sessions.Count(row => row.UserId == before.Owner.Id && row.IsActive));
        Assert.Equal(before.Sessions.Count, after.Sessions.Count);
        foreach (var prior in before.Sessions)
        {
            var stored = Assert.Single(after.Sessions, row => row.Id == prior.Id);
            Assert.Equal((prior.UserId, prior.Token, prior.DeviceFingerprint, prior.ExpiresAt),
                (stored.UserId, stored.Token, stored.DeviceFingerprint, stored.ExpiresAt));
            if (prior.UserId == before.Owner.Id && prior.IsActive)
            {
                Assert.True(stored.IsRevoked, "A refresh session of the affected account remained active.");
                Assert.Equal(expectedReason, stored.RevokedReason);
                Assert.Equal(expectedIp, stored.RevokedByIp);
            }
            else
            {
                Assert.Equal((prior.RevokedAt, prior.RevokedReason, prior.RevokedByIp, prior.ReplacedByToken),
                    (stored.RevokedAt, stored.RevokedReason, stored.RevokedByIp, stored.ReplacedByToken));
            }
        }
    }

    private static async Task<SessionSnapshot> ReadSnapshotAsync(
        TemporaryDatabase database, Guid userId, CancellationToken token)
    {
        await using var context = CreateContext(database);
        var user = await context.Users.AsNoTracking().SingleAsync(row => row.Id == userId, token);
        var sessions = await context.RefreshTokens.AsNoTracking().ToListAsync(token);
        var history = await context.PasswordHistory.AsNoTracking().Where(row => row.UserId == userId).ToListAsync(token);
        return new SessionSnapshot(user, sessions, history);
    }

    private static AuthDbContext CreateContext(TemporaryDatabase database) =>
        new(database.Options<AuthDbContext>(), Mock.Of<IDomainEventDispatcher>());

    private static ICurrentUserService CurrentUser(Guid userId) =>
        Mock.Of<ICurrentUserService>(service => service.UserId == userId && service.IpAddress == ClientIp);

    private sealed record SessionSnapshot(
        User Owner, IReadOnlyList<RefreshToken> Sessions, IReadOnlyList<PasswordHistory> History);
}
