using System.Data.Common;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Planora.Auth.Domain.Entities;
using Planora.Auth.Domain.ValueObjects;
using Planora.Auth.Infrastructure.Persistence;
using Planora.Auth.Infrastructure.Services.Authentication;
using Planora.Auth.Infrastructure.Services.Security;
using Planora.BuildingBlocks.Application.Messaging;
using Planora.UnitTests.BuildingBlocks.Retention.Postgres;

namespace Planora.UnitTests.Services.AuthApi.Infrastructure;

public sealed class AuthRecoveryCodePostgresTests
{
    private const string SyntheticCode = "ABCDE-12345";

    [PostgresFact]
    public async Task ConcurrentConsume_SameRecoveryCodeHasOneWinner()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        await using var seed = CreateContext(database.Options<AuthDbContext>());
        var hasher = new PasswordHasher();
        var code = await SeedAsync(seed, hasher);
        var barrier = new RecoveryReadBarrier();
        var options = new DbContextOptionsBuilder<AuthDbContext>(database.Options<AuthDbContext>())
            .AddInterceptors(barrier).Options;
        await using var first = CreateContext(options);
        await using var second = CreateContext(options);
        using var firstUnit = new AuthUnitOfWork(first);
        using var secondUnit = new AuthUnitOfWork(second);
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));

        var results = await Task.WhenAll(
            new RecoveryCodeService(firstUnit, hasher, NullLogger<RecoveryCodeService>.Instance)
                .ValidateAndConsumeCodeAsync(code.UserId, SyntheticCode.ToLowerInvariant(), timeout.Token),
            new RecoveryCodeService(secondUnit, hasher, NullLogger<RecoveryCodeService>.Instance)
                .ValidateAndConsumeCodeAsync(code.UserId, SyntheticCode, timeout.Token));

        Assert.True(barrier.BothReadsReached);
        Assert.Single(results, consumed => consumed);
        Assert.Single(results, consumed => !consumed);
        var stored = await seed.Set<UserRecoveryCode>().AsNoTracking().SingleAsync(x => x.Id == code.Id);
        Assert.True(stored.IsUsed);
        Assert.NotNull(stored.UsedAt);
        Assert.NotNull(stored.UpdatedAt);
        Assert.Equal(code.UserId, stored.UpdatedBy);
    }

    [PostgresFact]
    public async Task Consume_RejectsWrongOwnerWrongCodeUsedCodeAndCancellation()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        await using var seed = CreateContext(database.Options<AuthDbContext>());
        var hasher = new PasswordHasher();
        var code = await SeedAsync(seed, hasher);
        await using var context = CreateContext(database.Options<AuthDbContext>());
        using var unit = new AuthUnitOfWork(context);
        var service = new RecoveryCodeService(unit, hasher, NullLogger<RecoveryCodeService>.Instance);

        Assert.False(await service.ValidateAndConsumeCodeAsync(Guid.NewGuid(), SyntheticCode));
        Assert.False(await service.ValidateAndConsumeCodeAsync(code.UserId, "wrong"));
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            service.ValidateAndConsumeCodeAsync(code.UserId, SyntheticCode, new CancellationToken(canceled: true)));
        Assert.True(await service.ValidateAndConsumeCodeAsync(code.UserId, SyntheticCode));
        Assert.False(await service.ValidateAndConsumeCodeAsync(code.UserId, SyntheticCode));
    }

    private static AuthDbContext CreateContext(DbContextOptions<AuthDbContext> options) =>
        new(options, Mock.Of<IDomainEventDispatcher>());

    private static async Task<UserRecoveryCode> SeedAsync(AuthDbContext context, PasswordHasher hasher)
    {
        await AuthDatabaseStartup.EnsureReadyAsync(context, NullLogger.Instance);
        var user = User.Create(Email.Create("recovery-audit@example.test"), "synthetic-hash", "Audit", "Fixture");
        var code = new UserRecoveryCode(user.Id, hasher.HashPassword(SyntheticCode));
        context.Users.Add(user);
        context.Set<UserRecoveryCode>().Add(code);
        await context.SaveChangesAsync();
        return code;
    }

    private sealed class RecoveryReadBarrier : DbCommandInterceptor
    {
        private readonly TaskCompletionSource _reads = new(TaskCreationOptions.RunContinuationsAsynchronously);
        private int _count;

        public bool BothReadsReached => _reads.Task.IsCompletedSuccessfully;

        public override async ValueTask<DbDataReader> ReaderExecutedAsync(
            DbCommand command, CommandExecutedEventData eventData, DbDataReader result,
            CancellationToken cancellationToken = default)
        {
            if (command.CommandText.StartsWith("SELECT", StringComparison.Ordinal) &&
                command.CommandText.Contains("\"UserRecoveryCodes\"", StringComparison.Ordinal))
            {
                if (Interlocked.Increment(ref _count) == 2)
                    _reads.TrySetResult();
                await _reads.Task.WaitAsync(TimeSpan.FromSeconds(10), cancellationToken);
            }

            return result;
        }
    }
}
