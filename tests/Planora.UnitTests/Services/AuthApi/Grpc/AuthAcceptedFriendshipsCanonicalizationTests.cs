using Microsoft.EntityFrameworkCore;
using Moq;
using Planora.Auth.Application.Features.Friendships.Queries.GetFriendships;
using Planora.Auth.Domain.Entities;
using Planora.Auth.Domain.ValueObjects;
using Planora.Auth.Infrastructure.Persistence;
using Planora.Auth.Infrastructure.Persistence.Repositories;
using Planora.BuildingBlocks.Application.Messaging;
using Planora.UnitTests.BuildingBlocks.Retention.Postgres;

namespace Planora.UnitTests.Services.AuthApi.Grpc;

public sealed class AuthAcceptedFriendshipsCanonicalizationTests
{
    private static readonly DateTime Earlier = new(2026, 1, 2, 3, 4, 5, DateTimeKind.Utc);
    private static readonly DateTime Later = Earlier.AddDays(1);

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task AcceptedOppositeDirectionRows_ReturnOneFriendWithEarliestAcceptance(bool reverseInsertOrder)
    {
        await using var db = InMemory();
        var (owner, friend) = await SeedOppositeRowsAsync(db, hasLegacyNull: false, reverseInsertOrder);

        await AssertCanonicalAsync(db, owner, friend, Earlier);
        await AssertCanonicalAsync(db, friend, owner, Earlier);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task LegacyNullInAcceptedOppositeRows_PreservesUnknownHistoricalAcceptance(bool reverseInsertOrder)
    {
        await using var db = InMemory();
        var (owner, friend) = await SeedOppositeRowsAsync(db, hasLegacyNull: true, reverseInsertOrder);

        await AssertCanonicalAsync(db, owner, friend, expectedAcceptance: null);
        await AssertCanonicalAsync(db, friend, owner, expectedAcceptance: null);
    }

    [PostgresFact]
    public async Task RealPostgres_TwoAcceptedOppositeRowsRemainStoredButTheSnapshotHasOneFriend()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        await using var db = new AuthDbContext(database.Options<AuthDbContext>(), Mock.Of<IDomainEventDispatcher>());
        await db.Database.EnsureCreatedAsync();
        var (owner, friend) = await SeedOppositeRowsAsync(db, hasLegacyNull: false, reverseInsertOrder: true);

        await AssertCanonicalAsync(db, owner, friend, Earlier);
        await AssertCanonicalAsync(db, friend, owner, Earlier);
    }

    private static AuthDbContext InMemory() => new(
        new DbContextOptionsBuilder<AuthDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options,
        Mock.Of<IDomainEventDispatcher>());

    private static async Task<(Guid Owner, Guid Friend)> SeedOppositeRowsAsync(
        AuthDbContext db, bool hasLegacyNull, bool reverseInsertOrder)
    {
        var owner = User.Create(Email.Create($"owner-{Guid.NewGuid():N}@example.test"), "hash", "Owner", "Snapshot");
        var friend = User.Create(Email.Create($"friend-{Guid.NewGuid():N}@example.test"), "hash", "Friend", "Snapshot");
        db.Users.AddRange(owner, friend);
        var forward = Friendship.Create(owner.Id, friend.Id);
        forward.Accept(friend.Id);
        RetentionTestKit.Set(forward, nameof(Friendship.AcceptedAt), hasLegacyNull ? null : Earlier);
        var backward = Friendship.Create(friend.Id, owner.Id);
        backward.Accept(owner.Id);
        RetentionTestKit.Set(backward, nameof(Friendship.AcceptedAt), Later);
        var rows = reverseInsertOrder ? new[] { backward, forward } : new[] { forward, backward };
        db.Friendships.AddRange(rows);
        await db.SaveChangesAsync();
        db.ChangeTracker.Clear();
        Assert.Equal(2, await db.Friendships.CountAsync());
        return (owner.Id, friend.Id);
    }

    private static async Task AssertCanonicalAsync(AuthDbContext db, Guid owner, Guid friend, DateTime? expectedAcceptance)
    {
        var result = await new GetFriendshipsQueryHandler(new FriendshipRepository(db))
            .Handle(new GetFriendshipsQuery(owner), CancellationToken.None);
        Assert.True(result.IsSuccess);
        var entry = Assert.Single(result.Value);
        Assert.Equal(friend, entry.FriendId);
        Assert.Equal(expectedAcceptance, entry.AcceptedAt);
        if (entry.AcceptedAt is DateTime acceptedAt) Assert.Equal(DateTimeKind.Utc, acceptedAt.Kind);
        Assert.Empty(db.ChangeTracker.Entries());
        Assert.Equal(2, await db.Friendships.CountAsync());
    }
}
