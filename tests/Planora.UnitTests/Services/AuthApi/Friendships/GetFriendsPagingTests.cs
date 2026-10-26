using Planora.Auth.Application.Common.Interfaces;
using Planora.Auth.Application.Features.Friendships.Queries.GetFriends;
using Planora.Auth.Domain.Entities;
using Planora.Auth.Domain.Enums;
using Planora.Auth.Domain.Repositories;
using Planora.Auth.Domain.ValueObjects;
using Microsoft.Extensions.Logging;
using Moq;

namespace Planora.UnitTests.Services.AuthApi.Friendships;

/// <summary>
/// The friend list is read page by page (FE-11, API-14): every page has the size the result
/// reports, and the pages follow one order however the repository returns the rows.
/// </summary>
public sealed class GetFriendsPagingTests
{
    private static readonly DateTime Start = new(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);

    [Fact]
    [Trait("TestType", "Functional")]
    [Trait("TestType", "Regression")]
    public async Task Pages_AreCutAtTheSizeTheResultReports()
    {
        var (handler, _) = Setup(friendCount: 150);

        // Asked for 200: the result says 100 a page, and the page holds 100 — it used to hold 200.
        var first = (await handler.Handle(new GetFriendsQuery(PageNumber: 1, PageSize: 200), CancellationToken.None)).Value!;
        var second = (await handler.Handle(new GetFriendsQuery(PageNumber: 2, PageSize: 200), CancellationToken.None)).Value!;

        Assert.Equal(100, first.PageSize);
        Assert.Equal(100, first.Items.Count);
        Assert.Equal(150, first.TotalCount);
        Assert.Equal(2, first.TotalPages);
        Assert.True(first.HasNextPage);
        Assert.Equal(50, second.Items.Count);
        Assert.False(second.HasNextPage);
        Assert.Empty(first.Items.Select(f => f.Id).Intersect(second.Items.Select(f => f.Id)));
    }

    [Fact]
    [Trait("TestType", "Functional")]
    [Trait("TestType", "Regression")]
    public async Task Pages_FollowTheOldestFriendshipFirst_WhateverOrderTheRowsArriveIn()
    {
        var (handler, expected) = Setup(friendCount: 7, shuffle: true);

        var items = new List<Guid>();
        for (var page = 1; page <= 4; page++)
            items.AddRange((await handler.Handle(new GetFriendsQuery(PageNumber: page, PageSize: 2), CancellationToken.None)).Value!.Items.Select(f => f.Id));

        Assert.Equal(expected, items);
    }

    [Fact]
    [Trait("TestType", "Unit")]
    public async Task OutOfRangePaging_IsNormalised()
    {
        var (handler, _) = Setup(friendCount: 3);

        var result = (await handler.Handle(new GetFriendsQuery(PageNumber: 0, PageSize: 0), CancellationToken.None)).Value!;

        Assert.Equal(1, result.PageNumber);
        Assert.Equal(10, result.PageSize);
        Assert.Equal(3, result.Items.Count);
    }

    /// <summary>
    /// A user with <paramref name="friendCount"/> accepted friends, accepted a minute apart, and
    /// the friend ids in the order the list must show them.
    /// </summary>
    private static (GetFriendsQueryHandler Handler, List<Guid> Expected) Setup(int friendCount, bool shuffle = false)
    {
        var userId = Guid.NewGuid();
        var friends = Enumerable.Range(0, friendCount)
            .Select(i => User.Create(Email.Create($"friend{i}@example.com"), "hash", "Friend", $"{i}"))
            .ToList();
        var friendships = friends.Select((friend, i) =>
        {
            var friendship = Friendship.Create(userId, friend.Id);
            friendship.Accept(friend.Id);
            typeof(Friendship).GetProperty(nameof(Friendship.AcceptedAt))!.SetValue(friendship, Start.AddMinutes(i));
            return friendship;
        }).ToList();
        var expected = friends.Select(f => f.Id).ToList();
        if (shuffle)
        {
            // The repository has no ORDER BY: hand the rows over in another order every time.
            friendships.Reverse();
            (friendships[0], friendships[^1]) = (friendships[^1], friendships[0]);
        }

        var repository = new Mock<IFriendshipRepository>();
        repository
            .Setup(x => x.GetFriendshipsForUserAsync(userId, FriendshipStatus.Accepted, It.IsAny<CancellationToken>()))
            .ReturnsAsync(friendships);
        var users = new Mock<IUserRepository>();
        users
            .Setup(x => x.GetByIdsAsync(It.IsAny<IEnumerable<Guid>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(friends);
        var currentUser = new Mock<ICurrentUserService>();
        currentUser.SetupGet(x => x.UserId).Returns(userId);

        var handler = new GetFriendsQueryHandler(repository.Object, users.Object, currentUser.Object, Mock.Of<ILogger<GetFriendsQueryHandler>>());
        return (handler, expected);
    }
}
