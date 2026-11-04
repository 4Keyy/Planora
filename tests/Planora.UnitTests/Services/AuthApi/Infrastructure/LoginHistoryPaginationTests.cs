using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Planora.Auth.Application.Features.Users.Queries.GetLoginHistory;
using Planora.Auth.Domain.Entities;
using Planora.Auth.Domain.ValueObjects;
using Planora.Auth.Infrastructure.Persistence;
using Planora.Auth.Infrastructure.Persistence.Repositories;
using Planora.BuildingBlocks.Application.Messaging;
using Planora.UnitTests.BuildingBlocks.Retention.Postgres;

namespace Planora.UnitTests.Services.AuthApi.Infrastructure;

public sealed class LoginHistoryPaginationTests
{
    [Fact]
    public async Task LargeAcceptedPages_ReturnEmptyWithCurrentOwnerCount()
    {
        var options = new DbContextOptionsBuilder<AuthDbContext>()
            .UseInMemoryDatabase($"login-history-pagination-{Guid.NewGuid():N}")
            .Options;
        await using var db = new AuthDbContext(options, Mock.Of<IDomainEventDispatcher>());

        await CheckPaginationAsync(db);
    }

    [PostgresFact]
    public async Task LargeAcceptedPages_ReturnEmptyWithCurrentOwnerCount_OnPostgres()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        await using var db = new AuthDbContext(database.Options<AuthDbContext>(), Mock.Of<IDomainEventDispatcher>());
        await AuthDatabaseStartup.EnsureReadyAsync(db, NullLogger.Instance);

        await CheckPaginationAsync(db);
    }

    private static async Task CheckPaginationAsync(AuthDbContext db)
    {
        var owner = User.Create(Email.Create("history-owner@example.test"), "synthetic-hash", "History", "Owner");
        var other = User.Create(Email.Create("history-other@example.test"), "synthetic-hash", "Other", "Owner");
        var older = new LoginHistory(owner.Id, "192.0.2.10", "Older", true);
        var newer = new LoginHistory(owner.Id, "192.0.2.10", "Newer", true);
        var foreign = new LoginHistory(other.Id, "192.0.2.20", "Other", true);
        RetentionTestKit.Set(older, nameof(LoginHistory.LoginAt), DateTime.UtcNow.AddMinutes(-2));
        RetentionTestKit.Set(newer, nameof(LoginHistory.LoginAt), DateTime.UtcNow.AddMinutes(-1));
        db.Users.AddRange(owner, other);
        db.LoginHistory.AddRange(older, newer, foreign);
        await db.SaveChangesAsync();

        var repository = new LoginHistoryRepository(db);
        var firstPage = await repository.GetPagedByUserIdAsync(owner.Id, 1, 1);
        var secondPage = await repository.GetPagedByUserIdAsync(owner.Id, 2, 1);
        Assert.Equal(2, firstPage.TotalCount);
        Assert.Equal(newer.Id, Assert.Single(firstPage.Items).Id);
        Assert.Equal(2, secondPage.TotalCount);
        Assert.Equal(older.Id, Assert.Single(secondPage.Items).Id);

        var requests = new[]
        {
            new GetLoginHistoryQuery { PageNumber = int.MaxValue, PageSize = 100 },
            new GetLoginHistoryQuery { PageNumber = 1 + int.MaxValue / 100, PageSize = 100 },
            new GetLoginHistoryQuery { PageNumber = 2 + int.MaxValue / 100, PageSize = 100 }
        };
        foreach (var request in requests)
        {
            var page = await repository.GetPagedByUserIdAsync(owner.Id, request.PageNumber, request.PageSize);
            Assert.Equal(2, page.TotalCount);
            Assert.Empty(page.Items);
        }

        using var cancelled = new CancellationTokenSource();
        cancelled.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            repository.GetPagedByUserIdAsync(owner.Id, int.MaxValue, 100, cancelled.Token));
    }
}
