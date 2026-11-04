using System.Data.Common;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Moq;
using Planora.Auth.Application.Common.Interfaces;
using Planora.Auth.Application.Common.Options;
using Planora.Auth.Application.Features.Authentication.Commands.RequestPasswordReset;
using Planora.Auth.Application.Features.Authentication.Commands.ResetPassword;
using Planora.Auth.Application.Features.Authentication.Handlers.RequestPasswordReset;
using Planora.Auth.Application.Features.Authentication.Handlers.ResetPassword;
using Planora.Auth.Domain.Entities;
using Planora.Auth.Domain.Repositories;
using Planora.Auth.Domain.ValueObjects;
using Planora.Auth.Infrastructure.Persistence;
using Planora.Auth.Infrastructure.Services.Authentication;
using Planora.BuildingBlocks.Application.Messaging;
using Planora.UnitTests.BuildingBlocks.Retention.Postgres;

namespace Planora.UnitTests.Services.AuthApi.Infrastructure;

public sealed class AuthPasswordResetPostgresTests
{
    private const string FirstPassword = "Audit-Reset-Alpha-49!";
    private const string SecondPassword = "Audit-Reset-Beta-81!";
    private const string OriginalPasswordHash = "synthetic-original-password-hash";
    private readonly PasswordHasher _hasher = new();
    private readonly PasswordResetTokenService _tokens = new(new ConfigurationBuilder().Build());

    [PostgresFact]
    public async Task ResetAsync_ConcurrentValidRequests_CommitOnePasswordAndNotifyOnce()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        var resetToken = _tokens.GenerateToken();
        var resetHash = _tokens.HashToken(resetToken);
        var user = await SeedAsync(database, resetHash, expired: false);
        var barrier = new ResetReadBarrier(resetHash, expectedReads: 2);
        var options = InterceptedOptions(database, barrier);
        await using var firstContext = CreateContext(options);
        await using var secondContext = CreateContext(options);
        using var firstUnit = new AuthUnitOfWork(firstContext);
        using var secondUnit = new AuthUnitOfWork(secondContext);
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));

        var stamp = new Mock<ISecurityStampService>();
        stamp.Setup(x => x.SetStampAsync(user.Id, It.IsAny<CancellationToken>()))
            .Returns((Guid _, CancellationToken token) => AssertCommittedResetAsync(database, user.Id, token));
        var email = new Mock<IEmailService>();
        email.Setup(x => x.SendPasswordChangedNotificationAsync(
                user.Email.Value, user.FirstName, It.IsAny<CancellationToken>()))
            .Returns((string _, string _, CancellationToken token) => AssertCommittedResetAsync(database, user.Id, token));

        var results = await Task.WhenAll(
            CreateHandler(firstUnit, stamp.Object, email.Object).Handle(Command(resetToken, FirstPassword), timeout.Token),
            CreateHandler(secondUnit, stamp.Object, email.Object).Handle(Command(resetToken, SecondPassword), timeout.Token));

        Assert.True(barrier.ReadsObserved.IsCompletedSuccessfully);
        var winner = Assert.Single(results, result => result.IsSuccess);
        var loser = Assert.Single(results, result => result.IsFailure);
        Assert.Equal("INVALID_TOKEN", loser.Error!.Code);
        var winnerPassword = ReferenceEquals(winner, results[0]) ? FirstPassword : SecondPassword;
        var loserPassword = ReferenceEquals(winner, results[0]) ? SecondPassword : FirstPassword;

        await using var verify = CreateContext(database.Options<AuthDbContext>());
        var persisted = await verify.Users.AsNoTracking().Include(row => row.RefreshTokens)
            .SingleAsync(row => row.Id == user.Id, timeout.Token);
        Assert.True(_hasher.VerifyPassword(winnerPassword, persisted.PasswordHash));
        Assert.False(_hasher.VerifyPassword(loserPassword, persisted.PasswordHash));
        Assert.Null(persisted.PasswordResetToken);
        Assert.Null(persisted.PasswordResetTokenExpiry);
        Assert.True(Assert.Single(persisted.RefreshTokens).IsRevoked);
        stamp.Verify(x => x.SetStampAsync(user.Id, It.IsAny<CancellationToken>()), Times.Once);
        email.Verify(x => x.SendPasswordChangedNotificationAsync(
            user.Email.Value, user.FirstName, It.IsAny<CancellationToken>()), Times.Once);
    }

    [PostgresFact]
    public Task ResetAsync_ValidSnapshotCannotConsumeNewlyIssuedToken() => CheckSupersededResetAsync(expired: false);

    [PostgresFact]
    public Task ResetAsync_ExpiredSnapshotCannotClearNewlyIssuedToken() => CheckSupersededResetAsync(expired: true);

    [PostgresFact]
    public async Task ResetAsync_StillCurrentExpiredTokenIsCleared()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        var resetToken = _tokens.GenerateToken();
        var user = await SeedAsync(database, _tokens.HashToken(resetToken), expired: true);
        await using var context = CreateContext(database.Options<AuthDbContext>());
        using var unit = new AuthUnitOfWork(context);
        var stamp = new Mock<ISecurityStampService>();
        var email = new Mock<IEmailService>();
        var result = await CreateHandler(unit, stamp.Object, email.Object)
            .Handle(Command(resetToken, FirstPassword), CancellationToken.None);

        Assert.Equal("INVALID_TOKEN", result.Error?.Code);
        var persisted = await context.Users.AsNoTracking().Include(row => row.RefreshTokens)
            .SingleAsync(row => row.Id == user.Id);
        Assert.Equal(OriginalPasswordHash, persisted.PasswordHash);
        Assert.Null(persisted.PasswordResetToken);
        Assert.Null(persisted.PasswordResetTokenExpiry);
        Assert.True(Assert.Single(persisted.RefreshTokens).IsActive);
        stamp.VerifyNoOtherCalls();
        email.VerifyNoOtherCalls();
    }

    [PostgresFact]
    public async Task IssueAsync_StaleUserSnapshotCannotRestoreTheOldPassword()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        var resetToken = _tokens.GenerateToken();
        var resetHash = _tokens.HashToken(resetToken);
        var user = await SeedAsync(database, resetHash, expired: false);
        var resume = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var barrier = new ResetReadBarrier(user.Email.Value, expectedReads: 1, resume.Task);
        await using var issueContext = CreateContext(InterceptedOptions(database, barrier));
        await using var resetContext = CreateContext(database.Options<AuthDbContext>());
        using var issueUnit = new AuthUnitOfWork(issueContext);
        using var resetUnit = new AuthUnitOfWork(resetContext);
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        var issue = new RequestPasswordResetCommandHandler(issueUnit, Mock.Of<IEmailService>(), _tokens,
            Options.Create(new FrontendOptions { BaseUrl = "https://app.example.test" }),
            NullLogger<RequestPasswordResetCommandHandler>.Instance);
        var issuing = issue.Handle(new RequestPasswordResetCommand { Email = user.Email.Value }, timeout.Token);

        try
        {
            await barrier.ReadsObserved.WaitAsync(TimeSpan.FromSeconds(10), timeout.Token);
            var reset = await CreateHandler(resetUnit, Mock.Of<ISecurityStampService>(), Mock.Of<IEmailService>())
                .Handle(Command(resetToken, FirstPassword), timeout.Token);
            Assert.True(reset.IsSuccess);
        }
        finally
        {
            resume.TrySetResult();
            await issuing;
        }

        Assert.True((await issuing).IsSuccess);
        await using var verify = CreateContext(database.Options<AuthDbContext>());
        var persisted = await verify.Users.AsNoTracking().Include(row => row.RefreshTokens)
            .SingleAsync(row => row.Id == user.Id, timeout.Token);
        Assert.True(_hasher.VerifyPassword(FirstPassword, persisted.PasswordHash));
        Assert.NotNull(persisted.PasswordResetToken);
        Assert.NotEqual(resetHash, persisted.PasswordResetToken);
        Assert.True(Assert.Single(persisted.RefreshTokens).IsRevoked);
    }

    private async Task CheckSupersededResetAsync(bool expired)
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        var resetToken = _tokens.GenerateToken();
        var resetHash = _tokens.HashToken(resetToken);
        var user = await SeedAsync(database, resetHash, expired);
        var resume = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var barrier = new ResetReadBarrier(resetHash, expectedReads: 1, resume.Task);
        await using var resetContext = CreateContext(InterceptedOptions(database, barrier));
        using var resetUnit = new AuthUnitOfWork(resetContext);
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        var stamp = new Mock<ISecurityStampService>();
        var email = new Mock<IEmailService>();
        var pending = CreateHandler(resetUnit, stamp.Object, email.Object)
            .Handle(Command(resetToken, FirstPassword), timeout.Token);

        var replacementHash = _tokens.HashToken(_tokens.GenerateToken());
        try
        {
            await barrier.ReadsObserved.WaitAsync(TimeSpan.FromSeconds(10), timeout.Token);
            await using var issueContext = CreateContext(database.Options<AuthDbContext>());
            var current = await issueContext.Users.SingleAsync(row => row.Id == user.Id, timeout.Token);
            current.SetPasswordResetToken(replacementHash, DateTime.UtcNow.AddHours(1));
            await issueContext.SaveChangesAsync(timeout.Token);
        }
        finally
        {
            resume.TrySetResult();
        }

        var result = await pending;
        Assert.True(result.IsFailure);
        Assert.Equal("INVALID_TOKEN", result.Error!.Code);
        await using var verify = CreateContext(database.Options<AuthDbContext>());
        var persisted = await verify.Users.AsNoTracking().Include(row => row.RefreshTokens)
            .SingleAsync(row => row.Id == user.Id, timeout.Token);
        Assert.Equal(replacementHash, persisted.PasswordResetToken);
        Assert.True(persisted.PasswordResetTokenExpiry > DateTime.UtcNow);
        Assert.Equal(OriginalPasswordHash, persisted.PasswordHash);
        Assert.True(Assert.Single(persisted.RefreshTokens).IsActive);
        stamp.Verify(x => x.SetStampAsync(It.IsAny<Guid>(), It.IsAny<CancellationToken>()), Times.Never);
        email.Verify(x => x.SendPasswordChangedNotificationAsync(
            It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    private static async Task<User> SeedAsync(TemporaryDatabase database, string resetHash, bool expired)
    {
        await using var context = CreateContext(database.Options<AuthDbContext>());
        await AuthDatabaseStartup.EnsureReadyAsync(context, NullLogger.Instance);
        var user = User.Create(Email.Create("audit-reset@example.test"), OriginalPasswordHash, "Audit", "Reset");
        user.SetPasswordResetToken(resetHash, DateTime.UtcNow.AddHours(1));
        if (expired)
            RetentionTestKit.Set(user, nameof(User.PasswordResetTokenExpiry), DateTime.UtcNow.AddHours(-1));
        user.AddRefreshToken("synthetic-reset-refresh", "192.0.2.12", DateTime.UtcNow.AddDays(1));
        context.Users.Add(user);
        await context.SaveChangesAsync();
        return user;
    }

    private static async Task AssertCommittedResetAsync(TemporaryDatabase database, Guid userId, CancellationToken token)
    {
        await using var context = CreateContext(database.Options<AuthDbContext>());
        var persisted = await context.Users.AsNoTracking().Include(row => row.RefreshTokens)
            .SingleAsync(row => row.Id == userId, token);
        Assert.NotEqual(OriginalPasswordHash, persisted.PasswordHash);
        Assert.Null(persisted.PasswordResetToken);
        Assert.True(Assert.Single(persisted.RefreshTokens).IsRevoked);
    }

    private ResetPasswordCommandHandler CreateHandler(
        IAuthUnitOfWork unit, ISecurityStampService stamp, IEmailService email)
    {
        var validator = new Mock<IPasswordValidator>();
        validator.Setup(x => x.IsStrongPassword(It.IsAny<string>())).Returns(true);
        validator.Setup(x => x.IsPasswordCompromisedAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(false);
        return new ResetPasswordCommandHandler(
            unit, _hasher, validator.Object, _tokens, email, stamp, NullLogger<ResetPasswordCommandHandler>.Instance);
    }

    private static ResetPasswordCommand Command(string token, string password) =>
        new() { ResetToken = token, NewPassword = password, ConfirmPassword = password };

    private static DbContextOptions<AuthDbContext> InterceptedOptions(TemporaryDatabase database, ResetReadBarrier barrier) =>
        new DbContextOptionsBuilder<AuthDbContext>(database.Options<AuthDbContext>()).AddInterceptors(barrier).Options;

    private static AuthDbContext CreateContext(DbContextOptions<AuthDbContext> options) =>
        new(options, Mock.Of<IDomainEventDispatcher>());

    private sealed class ResetReadBarrier(string lookupValue, int expectedReads, Task? resume = null) : DbCommandInterceptor
    {
        private readonly TaskCompletionSource _observed = new(TaskCreationOptions.RunContinuationsAsynchronously);
        private int _readCount;

        public Task ReadsObserved => _observed.Task;

        public override async ValueTask<DbDataReader> ReaderExecutedAsync(
            DbCommand command, CommandExecutedEventData eventData, DbDataReader result,
            CancellationToken cancellationToken = default)
        {
            if (!command.CommandText.StartsWith("SELECT", StringComparison.Ordinal) ||
                !command.CommandText.Contains("\"PasswordResetToken\"", StringComparison.Ordinal) ||
                !command.Parameters.Cast<DbParameter>().Any(parameter => parameter.Value is string value && value == lookupValue))
            {
                return result;
            }

            var read = Interlocked.Increment(ref _readCount);
            if (read == expectedReads)
                _observed.TrySetResult();
            if (read <= expectedReads)
                await (resume ?? ReadsObserved).WaitAsync(TimeSpan.FromSeconds(15), cancellationToken);

            return result;
        }
    }
}
