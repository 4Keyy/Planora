using System.Linq.Expressions;
using System.Reflection;
using System.Text.Json;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Planora.BuildingBlocks.Application.Context;
using Planora.Todo.Api.Controllers;
using Planora.Todo.Application;
using Planora.Todo.Application.DTOs;
using Planora.Todo.Application.Features.Todos.Queries.GetFriendAffinity;
using Planora.Todo.Application.Services;
using Planora.Todo.Domain.Entities;
using Planora.Todo.Domain.Repositories;

namespace Planora.UnitTests.Services.TodoApi.Handlers;

public sealed class GetFriendAffinityTests
{
    private static readonly DateTime Now = new(2026, 10, 18, 12, 0, 0, DateTimeKind.Utc);

    [Fact]
    public async Task CountsBothDirectionsAndEachExplicitRecipientOnce()
    {
        var fixture = new Fixture();
        var first = fixture.AddFriend();
        var second = fixture.AddFriend();
        fixture.AddTodo(fixture.ViewerId, [first, second]);
        fixture.AddTodo(fixture.ViewerId, [first]);
        fixture.AddTodo(first, [fixture.ViewerId, second]);
        fixture.AddTodo(second, [first]); // A friend's share to someone else grants no interaction.

        var results = await fixture.ReadAsync();

        Assert.Equal(2, results.Count);
        Assert.Equal(new FriendAffinityDto { FriendId = first, Score = 3, SharedByMe = 2, SharedWithMe = 1 }, results[0]);
        Assert.Equal(new FriendAffinityDto { FriendId = second, Score = 1, SharedByMe = 1, SharedWithMe = 0 }, results[1]);
    }

    [Fact]
    public async Task ExcludesPublicDeletedAndSubtasksInBothDirections()
    {
        var fixture = new Fixture();
        var friend = fixture.AddFriend();
        foreach (var owner in new[] { fixture.ViewerId, friend })
        {
            var recipient = owner == friend ? fixture.ViewerId : friend;
            var parent = fixture.AddTodo(owner, [recipient]);
            fixture.AddTodo(owner, [recipient], isPublic: true);
            fixture.AddTodo(owner, [recipient], isPublic: true, snapshotAt: Now);
            fixture.AddTodo(owner, [recipient]).MarkAsDeleted(owner);
            fixture.Todos.Add(TodoItem.CreateSubtask(parent, owner, "Step", null));
        }

        var result = Assert.Single(await fixture.ReadAsync());

        Assert.Equal(1, result.SharedByMe);
        Assert.Equal(1, result.SharedWithMe);
        Assert.Equal(2, result.Score);
    }

    [Fact]
    public async Task KeepsCompletedAndHiddenInteractions()
    {
        var fixture = new Fixture();
        var friend = fixture.AddFriend();
        var done = fixture.AddTodo(fixture.ViewerId, [friend]);
        done.MarkAsDone(fixture.ViewerId);
        var hidden = fixture.AddTodo(friend, [fixture.ViewerId]);
        hidden.SetHidden(true, friend);
        SetActivity(done, Now, Now);
        SetActivity(hidden, Now, Now);

        var result = Assert.Single(await fixture.ReadAsync());

        Assert.Equal(1, result.SharedByMe);
        Assert.Equal(1, result.SharedWithMe);
        Assert.Equal(2, result.Score);
    }

    [Fact]
    public async Task ExcludesFormerFriendsNonFriendsAndFriendsWithoutInteractions()
    {
        var fixture = new Fixture();
        var friend = fixture.AddFriend();
        fixture.AddFriend();
        var former = Guid.NewGuid();
        var stranger = Guid.NewGuid();
        fixture.AddTodo(fixture.ViewerId, [friend, former, stranger]);
        fixture.AddTodo(friend, [fixture.ViewerId]);
        fixture.AddTodo(former, [fixture.ViewerId]);
        fixture.AddTodo(stranger, [fixture.ViewerId]);

        var result = Assert.Single(await fixture.ReadAsync());

        Assert.Equal(friend, result.FriendId);
        Assert.Equal(2, result.Score);
    }

    [Theory]
    [InlineData(0, 1)]
    [InlineData(30, 0.5)]
    [InlineData(60, 0.33)]
    [InlineData(50, 0.38)] // 0.375 rounds away from zero.
    [InlineData(15.5, 0.66)]
    [InlineData(-3, 1)]
    public async Task WeightsByFractionalAgeClampsFutureAndRounds(double ageDays, double expected)
    {
        var fixture = new Fixture();
        var friend = fixture.AddFriend();
        fixture.AddTodo(friend, [fixture.ViewerId], activityAt: Now.AddDays(-ageDays));

        var result = Assert.Single(await fixture.ReadAsync());

        Assert.Equal(expected, result.Score);
        Assert.Equal(1, result.SharedWithMe);
    }

    [Fact]
    public async Task UsesUpdatedAtAndFallsBackToCreatedAt()
    {
        var fixture = new Fixture();
        var friend = fixture.AddFriend();
        var updated = fixture.AddTodo(fixture.ViewerId, [friend]);
        SetActivity(updated, Now.AddDays(-90), Now);
        var createdOnly = fixture.AddTodo(friend, [fixture.ViewerId]);
        SetActivity(createdOnly, Now.AddDays(-30), null);

        Assert.Equal(1.5, Assert.Single(await fixture.ReadAsync()).Score);
    }

    [Fact]
    public async Task SumsWeightsBeforeRoundingAndKeepsVeryOldInteractions()
    {
        var fixture = new Fixture();
        var friend = fixture.AddFriend();
        fixture.AddTodo(fixture.ViewerId, [friend], activityAt: Now.AddDays(-7470));
        fixture.AddTodo(friend, [fixture.ViewerId], activityAt: Now.AddDays(-7470));
        var oldFriend = fixture.AddFriend();
        fixture.AddTodo(oldFriend, [fixture.ViewerId], activityAt: Now.AddDays(-20000));

        var results = await fixture.ReadAsync();

        Assert.Equal(2, results.Count);
        Assert.Equal(0.01, results[0].Score);
        Assert.Equal(2, results[0].SharedByMe + results[0].SharedWithMe);
        Assert.Equal(oldFriend, results[1].FriendId);
        Assert.Equal(0, results[1].Score);
        Assert.Equal(1, results[1].SharedWithMe);
    }

    [Fact]
    public async Task SortsByReturnedScoreThenInteractionCountThenFriendId()
    {
        var fixture = new Fixture();
        var lowId = Guid.Parse("00000000-0000-0000-0000-000000000001");
        var highId = Guid.Parse("00000000-0000-0000-0000-000000000002");
        var single = Guid.Parse("00000000-0000-0000-0000-000000000003");
        var strongest = Guid.Parse("00000000-0000-0000-0000-000000000004");
        var weakest = Guid.Parse("00000000-0000-0000-0000-000000000005");
        fixture.FriendIds.AddRange([weakest, single, highId, strongest, lowId]);
        foreach (var friend in new[] { lowId, highId })
        {
            fixture.AddTodo(fixture.ViewerId, [friend], activityAt: Now.AddDays(-30));
            fixture.AddTodo(friend, [fixture.ViewerId], activityAt: Now.AddDays(friend == highId ? -30.001 : -30));
        }
        fixture.AddTodo(fixture.ViewerId, [single]);
        fixture.AddTodo(fixture.ViewerId, [strongest]);
        fixture.AddTodo(strongest, [fixture.ViewerId]);
        fixture.AddTodo(weakest, [fixture.ViewerId], activityAt: Now.AddDays(-60));

        var results = await fixture.ReadAsync();

        Assert.Equal(new[] { strongest, lowId, highId, single, weakest }, results.Select(r => r.FriendId));
        Assert.Equal(new[] { 2d, 1d, 1d, 1d, 0.33 }, results.Select(r => r.Score));
    }

    [Fact]
    public async Task NoCurrentFriendsReturnsEmptyWithoutQueryingTasks()
    {
        var fixture = new Fixture();
        fixture.FriendIds.Add(Guid.Empty);
        fixture.AddTodo(fixture.ViewerId, [Guid.NewGuid()]);

        Assert.Empty(await fixture.ReadAsync());
        fixture.Repository.Verify(r => r.GetFriendShareKeysAsync(
            It.IsAny<Expression<Func<TodoItem, bool>>>(), It.IsAny<Guid>(),
            It.IsAny<IReadOnlyCollection<Guid>>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task FriendsButNoSharesReturnsEmpty()
    {
        var fixture = new Fixture();
        var friend = fixture.AddFriend();
        fixture.AddTodo(fixture.ViewerId, []);
        fixture.AddTodo(friend, []);

        Assert.Empty(await fixture.ReadAsync());
    }

    [Fact]
    public async Task RejectsMissingUserContextBeforeLookingUpFriends()
    {
        var fixture = new Fixture(Guid.Empty);

        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => fixture.ReadAsync());
        fixture.Friendship.VerifyNoOtherCalls();
        fixture.Repository.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task PassesCancellationToFriendshipAndRepository()
    {
        var fixture = new Fixture();
        fixture.AddFriend();
        using var cancellation = new CancellationTokenSource();

        await fixture.ReadAsync(cancellation.Token);

        fixture.Friendship.Verify(f => f.GetFriendshipsAsync(fixture.ViewerId, cancellation.Token), Times.Once);
        fixture.Repository.Verify(r => r.GetFriendShareKeysAsync(
            It.IsAny<Expression<Func<TodoItem, bool>>>(), fixture.ViewerId,
            It.IsAny<IReadOnlyCollection<Guid>>(), cancellation.Token), Times.Once);
    }

    [Fact]
    public async Task ControllerReturnsRawArrayWithExactJsonFieldsAndForwardsCancellation()
    {
        var mediator = new Mock<IMediator>();
        IReadOnlyList<FriendAffinityDto> response =
            [new() { FriendId = Guid.NewGuid(), Score = 3.42, SharedByMe = 4, SharedWithMe = 2 }];
        using var cancellation = new CancellationTokenSource();
        mediator.Setup(m => m.Send(It.IsAny<GetFriendAffinityQuery>(), cancellation.Token)).ReturnsAsync(response);
        var controller = new TodosController(mediator.Object, NullLogger<TodosController>.Instance);

        var result = await controller.GetFriendAffinity(cancellation.Token);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        Assert.Same(response, ok.Value);
        mediator.Verify(m => m.Send(It.IsAny<GetFriendAffinityQuery>(), cancellation.Token), Times.Once);
        using var json = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value, new JsonSerializerOptions(JsonSerializerDefaults.Web)));
        Assert.Equal(JsonValueKind.Array, json.RootElement.ValueKind);
        Assert.Equal(new[] { "friendId", "score", "sharedByMe", "sharedWithMe" },
            json.RootElement[0].EnumerateObject().Select(p => p.Name));
        var method = typeof(TodosController).GetMethod(nameof(TodosController.GetFriendAffinity))!;
        Assert.Equal("friend-affinity", method.GetCustomAttribute<HttpGetAttribute>()!.Template);
        Assert.NotNull(typeof(TodosController).GetCustomAttribute<AuthorizeAttribute>());
    }

    [Fact]
    public void ApplicationRegistersSystemClockAndRespectsAnExistingOverride()
    {
        using var defaults = new ServiceCollection().AddTodoApplication().BuildServiceProvider();
        Assert.Same(TimeProvider.System, defaults.GetRequiredService<TimeProvider>());
        var clock = new FixedTimeProvider();
        using var overridden = new ServiceCollection().AddSingleton<TimeProvider>(clock)
            .AddTodoApplication().BuildServiceProvider();
        Assert.Same(clock, overridden.GetRequiredService<TimeProvider>());
    }

    private static void SetActivity(TodoItem todo, DateTime createdAt, DateTime? updatedAt)
    {
        typeof(TodoItem).GetProperty(nameof(TodoItem.CreatedAt))!.SetValue(todo, createdAt);
        typeof(TodoItem).GetProperty(nameof(TodoItem.UpdatedAt))!.SetValue(todo, updatedAt);
    }

    private sealed class FixedTimeProvider : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => new(Now);
    }

    private sealed class Fixture
    {
        public Guid ViewerId { get; }
        public List<Guid> FriendIds { get; } = [];
        public List<TodoItem> Todos { get; } = [];
        public Mock<ITodoRepository> Repository { get; } = new();
        public Mock<IFriendshipService> Friendship { get; } = new();
        private GetFriendAffinityQueryHandler Handler { get; }

        public Fixture(Guid? viewerId = null)
        {
            ViewerId = viewerId ?? Guid.NewGuid();
            Repository.Setup(r => r.GetFriendShareKeysAsync(It.IsAny<Expression<Func<TodoItem, bool>>>(),
                    It.IsAny<Guid>(), It.IsAny<IReadOnlyCollection<Guid>>(), It.IsAny<CancellationToken>()))
                .ReturnsAsync((Expression<Func<TodoItem, bool>> predicate, Guid userId,
                    IReadOnlyCollection<Guid> friendIds, CancellationToken _) =>
                    (IReadOnlyList<TodoFriendShareKey>)Todos.Where(predicate.Compile())
                        .SelectMany(todo => todo.SharedWith.Where(share =>
                                (todo.UserId == userId && friendIds.Contains(share.SharedWithUserId)) ||
                                (friendIds.Contains(todo.UserId) && share.SharedWithUserId == userId)),
                            (todo, share) => new TodoFriendShareKey(todo.Id, todo.UserId,
                                todo.UpdatedAt ?? todo.CreatedAt, share.SharedWithUserId)).ToList());
            Friendship.Setup(f => f.GetFriendshipsAsync(ViewerId, It.IsAny<CancellationToken>()))
                .ReturnsAsync(() => (IReadOnlyList<FriendshipInfo>)FriendIds.Select(id => new FriendshipInfo(id, null)).ToArray());
            var currentUser = new Mock<ICurrentUserContext>();
            currentUser.SetupGet(c => c.UserId).Returns(ViewerId);
            Handler = new GetFriendAffinityQueryHandler(Repository.Object, Friendship.Object, currentUser.Object,
                new FixedTimeProvider(), NullLogger<GetFriendAffinityQueryHandler>.Instance);
        }

        public Guid AddFriend()
        {
            var id = Guid.NewGuid();
            FriendIds.Add(id);
            return id;
        }

        public TodoItem AddTodo(Guid owner, IEnumerable<Guid> sharedWith, DateTime? activityAt = null,
            bool isPublic = false, DateTime? snapshotAt = null)
        {
            var todo = TodoItem.Create(owner, "Task", isPublic: isPublic,
                sharedWithUserIds: sharedWith, allFriendsSnapshotAt: snapshotAt);
            SetActivity(todo, activityAt ?? Now, activityAt ?? Now);
            Todos.Add(todo);
            return todo;
        }

        public Task<IReadOnlyList<FriendAffinityDto>> ReadAsync(CancellationToken cancellationToken = default) =>
            Handler.Handle(new GetFriendAffinityQuery(), cancellationToken);
    }
}
