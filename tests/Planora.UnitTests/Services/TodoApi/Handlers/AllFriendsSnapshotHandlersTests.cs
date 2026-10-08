using System.Linq.Expressions;
using System.Text.Json;
using AutoMapper;
using MediatR;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Planora.BuildingBlocks.Application.Context;
using Planora.BuildingBlocks.Application.Outbox;
using Planora.BuildingBlocks.Application.Messaging.Events;
using Planora.BuildingBlocks.Domain.Exceptions;
using Planora.BuildingBlocks.Domain.Interfaces;
using Planora.GrpcContracts;
using Planora.Todo.Api.Grpc;
using Planora.Todo.Application.DTOs;
using Planora.Todo.Application.Features.Todos.Commands.CreateTodo;
using Planora.Todo.Application.Features.Todos.Commands.CreateSubtask;
using Planora.Todo.Application.Features.Todos.Commands.DeleteTodo;
using Planora.Todo.Application.Features.Todos.Commands.DuplicateTodo;
using Planora.Todo.Application.Features.Todos.Commands.JoinTodo;
using Planora.Todo.Application.Features.Todos.Commands.SetViewerPreference;
using Planora.Todo.Application.Features.Todos.Commands.UpdateTodo;
using Planora.Todo.Application.Features.Todos.Queries.GetTodoById;
using Planora.Todo.Application.Features.Todos.Queries.GetUserTodos;
using Planora.Todo.Application.Features.Todos.Queries.GetPublicTodos;
using Planora.Todo.Application.Features.Todos.Queries.GetSubtasks;
using Planora.Todo.Application.Interfaces;
using Planora.Todo.Application.Services;
using Planora.Todo.Domain.Entities;
using Planora.Todo.Domain.Repositories;
using Planora.UnitTests.Shared;

namespace Planora.UnitTests.Services.TodoApi.Handlers;

public sealed class AllFriendsSnapshotHandlersTests
{
    [Fact]
    public async Task CreatePublic_UsesUncachedCurrentFriendsAndUnlimitedCapacity()
    {
        var f = new Fixture(); var early = Guid.NewGuid(); var late = Guid.NewGuid();
        f.Accept(f.ViewerId, early); f.Accept(f.ViewerId, late);
        var dto = (await f.Create().Handle(new CreateTodoCommand(null, "shared", null, null, null, null, IsPublic: true, SharedWithUserIds: [early], RequiredWorkers: 3), default)).Value!;
        var task = Assert.Single(f.Todos);
        Assert.NotNull(task.AllFriendsSnapshotAt);
        Assert.Equal(DateTimeKind.Utc, task.AllFriendsSnapshotAt!.Value!.Kind);
        Assert.Equal(new HashSet<Guid> { early, late }, task.SharedWith.Select(s => s.SharedWithUserId).ToHashSet());
        Assert.Null(task.RequiredWorkers);
        Assert.Equal(new HashSet<Guid> { early, late }, dto.SharedWithUserIds.ToHashSet());
        f.Friendships.Verify(x => x.GetFriendshipsAsync(f.ViewerId, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task CreatePublic_RejectsExplicitIdsOutsideCurrentFriends()
    {
        var f = new Fixture();
        await Assert.ThrowsAsync<ForbiddenException>(() => f.Create().Handle(new CreateTodoCommand(null, "shared", null, null, null, null, IsPublic: true, SharedWithUserIds: [Guid.NewGuid()]), default));
        Assert.Empty(f.Todos);
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task Autosave_KeepsFrozenAudienceDespiteEmptyClientList(bool sendsPublicFlag)
    {
        var f = new Fixture(); var early = Guid.NewGuid(); var late = Guid.NewGuid();
        f.Accept(f.ViewerId, early); f.Accept(f.ViewerId, late);
        var task = f.Frozen(f.ViewerId, early); var stamp = task.AllFriendsSnapshotAt;
        await f.Update().Handle(new UpdateTodoCommand(task.Id, Title: "edited", IsPublic: sendsPublicFlag ? true : null, SharedWithUserIds: []), default);
        Assert.Equal(stamp, task.AllFriendsSnapshotAt);
        Assert.Equal(new[] { early }, task.SharedWith.Select(s => s.SharedWithUserId));
        f.Friendships.Verify(x => x.GetFriendshipsAsync(It.IsAny<Guid>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task PublicOffOn_TakesFreshSnapshotAndIgnoresClientIds()
    {
        var f = new Fixture(); var early = Guid.NewGuid(); var late = Guid.NewGuid();
        f.Accept(f.ViewerId, early); f.Accept(f.ViewerId, late);
        var task = f.Frozen(f.ViewerId, early); task.AddWorker(early);
        await f.Update().Handle(new UpdateTodoCommand(task.Id, IsPublic: false), default);
        Assert.False(task.IsPublic); Assert.Null(task.AllFriendsSnapshotAt); Assert.Empty(task.SharedWith); Assert.Empty(task.Workers);
        await f.Update().Handle(new UpdateTodoCommand(task.Id, IsPublic: true, SharedWithUserIds: [Guid.NewGuid()]), default);
        Assert.True(task.IsPublic); Assert.NotNull(task.AllFriendsSnapshotAt);
        Assert.Equal(new HashSet<Guid> { early, late }, task.SharedWith.Select(s => s.SharedWithUserId).ToHashSet());
    }

    [Fact]
    public async Task PublicOff_DirectSharesRetainOnlyValidatedFriends()
    {
        var f = new Fixture(); var early = Guid.NewGuid(); var late = Guid.NewGuid();
        f.Accept(f.ViewerId, early); f.Accept(f.ViewerId, late);
        var task = f.Frozen(f.ViewerId, early, late); task.AddWorker(early); task.AddWorker(late);
        await f.Update().Handle(new UpdateTodoCommand(task.Id, IsPublic: false, SharedWithUserIds: [late]), default);
        Assert.Null(task.AllFriendsSnapshotAt);
        Assert.Equal(new[] { late }, task.SharedWith.Select(s => s.SharedWithUserId));
        Assert.Equal(new[] { late }, task.Workers.Select(w => w.UserId));
    }

    [Fact]
    public async Task LegacyOwnerEdit_FreezesAtCreationAndResyncsSubtasksEvenWithoutVisibilityFields()
    {
        var f = new Fixture(); var task = f.Legacy(f.ViewerId);
        var early = Guid.NewGuid(); var late = Guid.NewGuid(); var undated = Guid.NewGuid(); var explicitShare = Guid.NewGuid();
        f.Accept(f.ViewerId, early, task.CreatedAt.AddSeconds(-1));
        f.Accept(f.ViewerId, late, task.CreatedAt.AddSeconds(1));
        f.Accept(f.ViewerId, undated, null);
        task.SetSharedWith([explicitShare], f.ViewerId);
        var child = TodoItem.CreateSubtask(task, f.ViewerId, "child", null); f.Todos.Add(child);
        await f.Update().Handle(new UpdateTodoCommand(task.Id, Title: "changed"), default);
        Assert.Equal(task.CreatedAt, task.AllFriendsSnapshotAt);
        Assert.Equal(new HashSet<Guid> { early, undated, explicitShare }, task.SharedWith.Select(s => s.SharedWithUserId).ToHashSet());
        Assert.Equal(task.AllFriendsSnapshotAt, child.AllFriendsSnapshotAt);
        Assert.Equal(task.SharedWith.Select(s => s.SharedWithUserId), child.SharedWith.Select(s => s.SharedWithUserId));
    }

    [Fact]
    public async Task LegacySubtaskEdit_DoesNotFreezeAnAudienceIndependentlyOfItsParent()
    {
        var f = new Fixture(); var friend = Guid.NewGuid(); f.Accept(f.ViewerId, friend);
        var parent = f.Legacy(f.ViewerId);
        var child = TodoItem.CreateSubtask(parent, f.ViewerId, "child", null); f.Todos.Add(child);
        await f.Update().Handle(new UpdateTodoCommand(child.Id, Title: "edited"), default);
        Assert.Null(child.AllFriendsSnapshotAt);
        Assert.Equal(parent.SharedWith.Select(s => s.SharedWithUserId), child.SharedWith.Select(s => s.SharedWithUserId));
        f.Friendships.Verify(x => x.GetFriendshipsAsync(It.IsAny<Guid>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task LegacyPublicOff_KeepsWorkersWhoRemainInTheNewDirectAudience()
    {
        var f = new Fixture(); var friend = Guid.NewGuid(); f.Accept(f.ViewerId, friend);
        var task = f.Legacy(f.ViewerId); task.AddWorker(friend);
        await f.Update().Handle(new UpdateTodoCommand(task.Id, IsPublic: false, SharedWithUserIds: [friend]), default);
        Assert.False(task.IsPublic); Assert.Null(task.AllFriendsSnapshotAt);
        Assert.Equal(new[] { friend }, task.Workers.Select(w => w.UserId));
    }

    [Fact]
    public async Task DuplicatePublic_UsesFreshDuplicatorFriends()
    {
        var f = new Fixture(); var early = Guid.NewGuid(); var late = Guid.NewGuid();
        f.Accept(f.ViewerId, early); f.Accept(f.ViewerId, late);
        var source = f.Frozen(f.ViewerId, early);
        var result = await f.Duplicate().Handle(new DuplicateTodoCommand(source.Id), default);
        var copy = Assert.Single(f.Todos, t => t.Id != source.Id);
        Assert.Equal(copy.Id, result.Value!.Id);
        Assert.NotNull(copy.AllFriendsSnapshotAt);
        Assert.Equal(new HashSet<Guid> { early, late }, copy.SharedWith.Select(s => s.SharedWithUserId).ToHashSet());
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Lists_ExcludeLaterFriendAndRedactAudienceForSnapshotFriend(bool singleFriendFeed)
    {
        var f = new Fixture(); var owner = Guid.NewGuid(); var early = Guid.NewGuid();
        f.Accept(owner, f.ViewerId); // current friend, but not in the old circle
        var task = f.Frozen(owner, early);
        var ownList = await f.List().Handle(new GetUserTodosQuery(null), default);
        Assert.Empty(ownList.Items);
        var feed = await f.Public().Handle(new GetPublicTodosQuery(FriendId: singleFriendFeed ? owner : null), default);
        Assert.True(feed.IsSuccess); Assert.Empty(feed.Value!.Items);
        task.FreezeAllFriendsAudience([early, f.ViewerId], DateTime.UtcNow);
        Assert.Empty(Assert.Single((await f.List().Handle(new GetUserTodosQuery(null), default)).Items).SharedWithUserIds);
        var visibleFeed = await f.Public().Handle(new GetPublicTodosQuery(FriendId: singleFriendFeed ? owner : null), default);
        Assert.Empty(Assert.Single(visibleFeed.Value!.Items).SharedWithUserIds);
    }

    [Theory]
    [InlineData("list")]
    [InlineData("stats")]
    [InlineData("archive")]
    [InlineData("viewer-category")]
    [InlineData("reveal-hidden")]
    [InlineData("public")]
    [InlineData("public-friend")]
    public async Task Lists_DoNotAuthoriseFromAStaleCachedFriendListAfterUnfriend(string surface)
    {
        var f = new Fixture(); var owner = Guid.NewGuid();
        var task = f.Frozen(owner, f.ViewerId);
        // The materialised share survives until the removal consumer runs; live friendship is gone.
        f.Friendships.Setup(x => x.GetFriendIdsAsync(f.ViewerId, It.IsAny<CancellationToken>())).ReturnsAsync(new[] { owner });
        if (surface is "list" or "stats" or "archive" or "viewer-category" or "reveal-hidden")
        {
            Guid? viewerCategory = null;
            if (surface == "archive") task.MarkAsDone(owner);
            if (surface == "viewer-category") { viewerCategory = Guid.NewGuid(); f.SetViewerCategory(task.Id, viewerCategory.Value); }
            var query = new GetUserTodosQuery(null, CategoryId: viewerCategory,
                IsCompleted: surface == "archive" ? true : null, IncludeSubtasks: surface == "stats", RevealHidden: surface == "reveal-hidden");
            Assert.Empty((await f.List().Handle(query, default)).Items);
        }
        else
        {
            var result = await f.Public().Handle(new GetPublicTodosQuery(FriendId: surface == "public-friend" ? owner : null), default);
            if (surface == "public-friend") { Assert.True(result.IsFailure); Assert.Equal("NOT_FRIENDS", result.Error!.Code); }
            else { Assert.True(result.IsSuccess); Assert.Empty(result.Value!.Items); }
        }
    }

    [Theory]
    [InlineData("create")]
    [InlineData("update")]
    public async Task DirectSharing_DoesNotValidateFromAStaleCachedFriendList(string surface)
    {
        var f = new Fixture(); var formerFriend = Guid.NewGuid();
        f.Friendships.Setup(x => x.GetFriendIdsAsync(f.ViewerId, It.IsAny<CancellationToken>())).ReturnsAsync(new[] { formerFriend });
        var task = TodoItem.Create(f.ViewerId, "private"); f.Todos.Add(task);
        await Assert.ThrowsAsync<ForbiddenException>(async () =>
        {
            if (surface == "create") await f.Create().Handle(new CreateTodoCommand(null, "direct", null, null, null, null, SharedWithUserIds: [formerFriend]), default);
            else await f.Update().Handle(new UpdateTodoCommand(task.Id, SharedWithUserIds: [formerFriend]), default);
        });
    }

    [Fact]
    public async Task DuplicateDirect_DropsFormerFriendsDespiteAStaleCachedFriendList()
    {
        var f = new Fixture(); var formerFriend = Guid.NewGuid();
        f.Friendships.Setup(x => x.GetFriendIdsAsync(f.ViewerId, It.IsAny<CancellationToken>())).ReturnsAsync(new[] { formerFriend });
        var source = TodoItem.Create(f.ViewerId, "direct", sharedWithUserIds: [formerFriend]); f.Todos.Add(source);
        var result = await f.Duplicate().Handle(new DuplicateTodoCommand(source.Id), default);
        Assert.Empty(result.Value!.SharedWithUserIds);
    }

    [Theory]
    [InlineData("by-id")]
    [InlineData("join")]
    [InlineData("create-subtask")]
    [InlineData("subtasks")]
    [InlineData("duplicate")]
    [InlineData("viewer-preference")]
    [InlineData("update")]
    public async Task LaterFriend_IsDeniedOnEveryRuntimeSurface(string surface)
    {
        var f = new Fixture(); var owner = Guid.NewGuid(); f.Accept(owner, f.ViewerId);
        var task = f.Frozen(owner, Guid.NewGuid());
        await Assert.ThrowsAsync<ForbiddenException>(() => f.Run(surface, task.Id));
        Assert.Empty(task.Workers);
    }

    [Theory]
    [InlineData("by-id")]
    [InlineData("join")]
    [InlineData("create-subtask")]
    [InlineData("subtasks")]
    [InlineData("update")]
    [InlineData("complete")]
    [InlineData("complete-subtask")]
    [InlineData("edit-created-subtask")]
    public async Task SnapshotFriend_ReceivesPublicDtosWithNoAudienceIds(string surface)
    {
        var f = new Fixture(); var owner = Guid.NewGuid(); f.Accept(owner, f.ViewerId);
        var task = f.Frozen(owner, f.ViewerId, Guid.NewGuid());
        var child = TodoItem.CreateSubtask(task, owner, "child", null); f.Todos.Add(child);
        var dto = surface switch
        {
            "by-id" => (await f.ById().Handle(new GetTodoByIdQuery(task.Id), default)).Value!,
            "join" => (await f.Join().Handle(new JoinTodoCommand(task.Id), default)).Value!,
            "create-subtask" => (await f.Subtask().Handle(new CreateSubtaskCommand(task.Id, "new child"), default)).Value!,
            "update" => (await f.Update().Handle(new UpdateTodoCommand(task.Id), default)).Value!,
            "complete" => (await f.Update().Handle(new UpdateTodoCommand(task.Id, Status: "Done"), default)).Value!,
            "complete-subtask" => (await f.Update().Handle(new UpdateTodoCommand(child.Id, Status: "Done"), default)).Value!,
            "edit-created-subtask" => (await f.Update().Handle(new UpdateTodoCommand(AddCreatedChild(f, task).Id, Title: "edited"), default)).Value!,
            _ => Assert.Single((await f.Subtasks().Handle(new GetSubtasksQuery(task.Id), default)).Value!)
        };
        Assert.True(dto.IsPublic); Assert.Empty(dto.SharedWithUserIds);
    }

    [Fact]
    public async Task UnfriendAndReadd_DoesNotRestoreDeletedSnapshotShare()
    {
        var f = new Fixture(); var owner = Guid.NewGuid(); f.Accept(owner, f.ViewerId);
        var task = f.Frozen(owner, f.ViewerId);
        f.Unfriend(owner, f.ViewerId);
        await Assert.ThrowsAsync<ForbiddenException>(() => f.ById().Handle(new GetTodoByIdQuery(task.Id), default));
        task.SetSharedWith([], owner); // the existing FriendshipRemoved consumer removes this row
        f.Accept(owner, f.ViewerId);
        await Assert.ThrowsAsync<ForbiddenException>(() => f.ById().Handle(new GetTodoByIdQuery(task.Id), default));
    }

    [Fact]
    public async Task CreatorWithoutCurrentAccess_CannotRenameOrDeleteTheirSubtask()
    {
        var f = new Fixture(); var owner = Guid.NewGuid(); f.Accept(owner, f.ViewerId);
        var parent = f.Frozen(owner, f.ViewerId);
        var child = TodoItem.CreateSubtask(parent, f.ViewerId, "child", null); f.Todos.Add(child);
        parent.FreezeAllFriendsAudience([], DateTime.UtcNow); child.SyncInheritedFromParent(parent, owner);
        await Assert.ThrowsAsync<ForbiddenException>(() => f.Update().Handle(new UpdateTodoCommand(child.Id, Title: "hijacked"), default));
        await Assert.ThrowsAsync<ForbiddenException>(() => f.Delete().Handle(new DeleteTodoCommand(child.Id), default));
        Assert.Equal("child", child.Title); Assert.False(child.IsDeleted);
    }

    [Fact]
    public async Task GrpcAccessAndParticipants_UseSnapshotAndDoNotExposeContentOnDenial()
    {
        var f = new Fixture(); var owner = Guid.NewGuid(); var other = Guid.NewGuid();
        f.Accept(owner, f.ViewerId); f.Accept(owner, other);
        var task = f.Frozen(owner, other);
        var service = f.Grpc();
        var request = new CheckTaskCommentAccessRequest { TaskId = task.Id.ToString(), RequesterId = f.ViewerId.ToString() };
        var denied = await service.CheckTaskCommentAccess(request, new FakeServerCallContext());
        Assert.False(denied.HasAccess); Assert.Empty(denied.Description); Assert.Empty(denied.TaskCreatedAt); Assert.Empty(denied.ParticipantIds);
        task.FreezeAllFriendsAudience([other, f.ViewerId], DateTime.UtcNow);
        var allowed = await service.CheckTaskCommentAccess(request, new FakeServerCallContext());
        Assert.True(allowed.HasAccess);
        Assert.Equal(new HashSet<string> { owner.ToString(), other.ToString(), f.ViewerId.ToString() }, allowed.ParticipantIds.ToHashSet());
        f.Unfriend(owner, f.ViewerId);
        Assert.False((await service.CheckTaskCommentAccess(request, new FakeServerCallContext())).HasAccess);
    }

    [Fact]
    public async Task LegacyFriend_StillReadsWithoutAnExplicitShareUntilFreeze()
    {
        var f = new Fixture(); var owner = Guid.NewGuid(); f.Accept(owner, f.ViewerId);
        var task = f.Legacy(owner);
        Assert.Equal(task.Id, (await f.ById().Handle(new GetTodoByIdQuery(task.Id), default)).Value!.Id);
        Assert.Single((await f.List().Handle(new GetUserTodosQuery(null), default)).Items);
        Assert.Single((await f.Public().Handle(new GetPublicTodosQuery(), default)).Value!.Items);
        Assert.True((await f.Grpc().CheckTaskCommentAccess(new CheckTaskCommentAccessRequest { TaskId = task.Id.ToString(), RequesterId = f.ViewerId.ToString() }, new FakeServerCallContext())).HasAccess);
    }

    [Fact]
    public async Task LostAudience_GetsOnlyInvalidationNotCompletionNotificationContent()
    {
        var f = new Fixture(); var early = Guid.NewGuid(); f.Accept(f.ViewerId, early);
        var task = f.Frozen(f.ViewerId, early);
        await f.Update().Handle(new UpdateTodoCommand(task.Id, IsPublic: false, Status: "Done"), default);
        var messages = f.OutboxMessages.Select(m => (m.Type, JsonDocument.Parse(m.Content).RootElement.Clone())).ToArray();
        var sync = Assert.Single(messages, m => m.Type.Contains("RealtimeSyncIntegrationEvent")).Item2;
        Assert.Contains(early.ToString(), sync.EnumerateObject().Single(property => property.Name.Equals("audienceUserIds", StringComparison.OrdinalIgnoreCase)).Value!.EnumerateArray().Select(x => x.GetString()));
        Assert.DoesNotContain(messages, m => m.Type.Contains("NotificationEvent"));
        Assert.DoesNotContain(sync.EnumerateObject(), property => property.Name.Equals("title", StringComparison.OrdinalIgnoreCase) || property.Name.Equals("description", StringComparison.OrdinalIgnoreCase));
    }

    [Theory]
    [InlineData("join", true)]
    [InlineData("join", false)]
    [InlineData("viewer-complete", true)]
    [InlineData("viewer-complete", false)]
    [InlineData("owner-complete", true)]
    [InlineData("owner-complete", false)]
    [InlineData("create-subtask", true)]
    [InlineData("create-subtask", false)]
    [InlineData("complete-subtask", true)]
    [InlineData("complete-subtask", false)]
    public async Task ContentNotifications_ExcludeFormerFriendsBeforeShareCleanup(string surface, bool legacy)
    {
        var f = new Fixture(); var former = Guid.NewGuid();
        var owner = surface is "join" or "viewer-complete" ? Guid.NewGuid() : f.ViewerId;
        var current = owner == f.ViewerId ? Guid.NewGuid() : f.ViewerId;
        f.Accept(owner, current);
        var task = legacy ? f.Legacy(owner) : f.Frozen(owner, current, former);
        if (legacy) task.SetSharedWith([current, former], owner);
        f.Friendships.Setup(x => x.GetFriendIdsAsync(owner, It.IsAny<CancellationToken>())).ReturnsAsync(new[] { current, former });
        switch (surface)
        {
            case "join": await f.Join().Handle(new JoinTodoCommand(task.Id), default); break;
            case "viewer-complete": case "owner-complete": await f.Update().Handle(new UpdateTodoCommand(task.Id, Status: "Done"), default); break;
            case "create-subtask": await f.Subtask().Handle(new CreateSubtaskCommand(task.Id, "new child"), default); break;
            default:
                var child = TodoItem.CreateSubtask(task, owner, "child", null); f.Todos.Add(child);
                await f.Update().Handle(new UpdateTodoCommand(child.Id, Status: "Done"), default); break;
        }
        var recipients = f.OutboxMessages.Where(m => m.Type.Contains(nameof(NotificationEvent)))
            .Select(m => JsonSerializer.Deserialize<NotificationEvent>(m.Content)!.UserId).ToArray();
        Assert.DoesNotContain(former, recipients);
        Assert.Contains(owner == f.ViewerId ? current : owner, recipients);
    }

    [Fact]
    public async Task ContentNotifications_OnAuthFailureReachOnlyOwnerAndDoNotFailTheJoin()
    {
        var f = new Fixture(); var owner = Guid.NewGuid(); var former = Guid.NewGuid(); f.Accept(owner, f.ViewerId);
        var task = f.Frozen(owner, f.ViewerId, former);
        f.Friendships.Setup(x => x.GetFriendshipsAsync(owner, It.IsAny<CancellationToken>())).ThrowsAsync(new InvalidOperationException("Auth unavailable"));
        Assert.True((await f.Join().Handle(new JoinTodoCommand(task.Id), default)).IsSuccess);
        var notification = Assert.Single(f.OutboxMessages, m => m.Type.Contains(nameof(NotificationEvent)));
        Assert.Equal(owner, JsonSerializer.Deserialize<NotificationEvent>(notification.Content)!.UserId);
        Assert.Contains(task.Workers, worker => worker.UserId == f.ViewerId);
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task GrpcParticipants_ExcludeFormerFriendsBeforeShareCleanup(bool legacy)
    {
        var f = new Fixture(); var current = Guid.NewGuid(); var former = Guid.NewGuid(); f.Accept(f.ViewerId, current);
        var task = legacy ? f.Legacy(f.ViewerId) : f.Frozen(f.ViewerId, current, former);
        if (legacy) task.SetSharedWith([current, former], f.ViewerId);
        f.Friendships.Setup(x => x.GetFriendIdsAsync(f.ViewerId, It.IsAny<CancellationToken>())).ReturnsAsync(new[] { current, former });
        var response = await f.Grpc().CheckTaskCommentAccess(new CheckTaskCommentAccessRequest { TaskId = task.Id.ToString(), RequesterId = f.ViewerId.ToString() }, new FakeServerCallContext());
        Assert.True(response.HasAccess);
        Assert.Equal(new HashSet<string> { f.ViewerId.ToString(), current.ToString() }, response.ParticipantIds.ToHashSet());
    }

    private static TodoItem AddCreatedChild(Fixture fixture, TodoItem parent)
    {
        var child = TodoItem.CreateSubtask(parent, fixture.ViewerId, "created child", null);
        fixture.Todos.Add(child);
        return child;
    }

    private sealed class Fixture
    {
        public Guid ViewerId { get; } = Guid.NewGuid();
        public List<TodoItem> Todos { get; } = [];
        public List<OutboxMessage> OutboxMessages { get; } = [];
        public Mock<ITodoRepository> Repository { get; } = new();
        public Mock<IFriendshipService> Friendships { get; } = new();
        private readonly Dictionary<Guid, Dictionary<Guid, DateTime?>> _friends = [];
        private readonly Mock<ICurrentUserContext> _user = new();
        private readonly Mock<IUserTodoViewPreferenceRepository> _preferences = new();
        private readonly Mock<IOutboxRepository> _outbox = new();
        private readonly IMapper _mapper;
        private readonly IUnitOfWork _uow = Mock.Of<IUnitOfWork>();
        private readonly ICategoryGrpcClient _category = Mock.Of<ICategoryGrpcClient>();
        private readonly Mock<IUserProfileService> _profiles = new();

        public Fixture()
        {
            _user.SetupGet(x => x.UserId).Returns(ViewerId);
            _mapper = new MapperConfiguration(cfg => cfg.AddProfile<TodoItemMappingProfile>(), NullLoggerFactory.Instance).CreateMapper();
            Friendships.Setup(x => x.GetFriendIdsAsync(It.IsAny<Guid>(), It.IsAny<CancellationToken>()))
                .ReturnsAsync((Guid id, CancellationToken _) => (IReadOnlyList<Guid>)(_friends.GetValueOrDefault(id)?.Keys.ToArray() ?? []));
            Friendships.Setup(x => x.GetFriendshipsAsync(It.IsAny<Guid>(), It.IsAny<CancellationToken>()))
                .ReturnsAsync((Guid id, CancellationToken _) => (IReadOnlyList<FriendshipInfo>)(_friends.GetValueOrDefault(id)?.Select(pair => new FriendshipInfo(pair.Key, pair.Value!)).ToArray() ?? []));
            Friendships.Setup(x => x.AreFriendsAsync(It.IsAny<Guid>(), It.IsAny<Guid>(), It.IsAny<CancellationToken>()))
                .ReturnsAsync((Guid a, Guid b, CancellationToken _) => _friends.GetValueOrDefault(a)?.ContainsKey(b) == true);
            Repository.Setup(x => x.GetByIdWithIncludesAsync(It.IsAny<Guid>(), It.IsAny<CancellationToken>())).ReturnsAsync((Guid id, CancellationToken _) => Todos.SingleOrDefault(t => t.Id == id));
            Repository.Setup(x => x.GetByIdWithIncludesTrackedAsync(It.IsAny<Guid>(), It.IsAny<CancellationToken>())).ReturnsAsync((Guid id, CancellationToken _) => Todos.SingleOrDefault(t => t.Id == id));
            Repository.Setup(x => x.AddAsync(It.IsAny<TodoItem>(), It.IsAny<CancellationToken>())).Callback<TodoItem, CancellationToken>((t, _) => Todos.Add(t)).ReturnsAsync((TodoItem t, CancellationToken _) => t);
            Repository.Setup(x => x.GetSubtasksAsync(It.IsAny<Guid>(), It.IsAny<CancellationToken>())).ReturnsAsync((Guid id, CancellationToken _) => (IReadOnlyList<TodoItem>)Todos.Where(t => t.ParentTodoId == id).ToArray());
            Repository.Setup(x => x.GetSubtasksTrackedAsync(It.IsAny<Guid>(), It.IsAny<CancellationToken>())).ReturnsAsync((Guid id, CancellationToken _) => (IReadOnlyList<TodoItem>)Todos.Where(t => t.ParentTodoId == id).ToArray());
            Repository.Setup(x => x.GetOpenSubtaskCountsAsync(It.IsAny<IReadOnlyCollection<Guid>>(), It.IsAny<CancellationToken>())).ReturnsAsync(new Dictionary<Guid, int>());
            Repository.Setup(x => x.GetPagedWithIncludesAsync(It.IsAny<Expression<Func<TodoItem, bool>>>(), It.IsAny<int>(), It.IsAny<int>(), It.IsAny<bool>(), It.IsAny<Guid?>(), It.IsAny<CancellationToken>()))
                .ReturnsAsync((Expression<Func<TodoItem, bool>> predicate, int page, int size, bool _, Guid? _, CancellationToken _) => Page(predicate, page, size));
            Repository.Setup(x => x.FindPageWithIncludesAsync(It.IsAny<Expression<Func<TodoItem, bool>>>(), It.IsAny<bool>(), It.IsAny<int>(), It.IsAny<int>(), It.IsAny<CancellationToken>()))
                .ReturnsAsync((Expression<Func<TodoItem, bool>> predicate, bool _, int page, int size, CancellationToken _) => Page(predicate, page, size));
            _preferences.Setup(x => x.GetCompletedViewerIdsForTodoAsync(It.IsAny<Guid>(), It.IsAny<CancellationToken>())).ReturnsAsync(new HashSet<Guid>());
            _preferences.Setup(x => x.GetHiddenTodoIdsAsync(It.IsAny<Guid>(), It.IsAny<CancellationToken>())).ReturnsAsync([]);
            _preferences.Setup(x => x.GetCompletedTodoIdsByViewerAsync(It.IsAny<Guid>(), It.IsAny<CancellationToken>())).ReturnsAsync([]);
            _preferences.Setup(x => x.GetByViewerIdForTodosAsync(It.IsAny<Guid>(), It.IsAny<IReadOnlyCollection<Guid>>(), It.IsAny<CancellationToken>())).ReturnsAsync(new Dictionary<Guid, UserTodoViewPreference>());
            _profiles.Setup(x => x.GetProfilesAsync(It.IsAny<IEnumerable<Guid>>(), It.IsAny<CancellationToken>())).ReturnsAsync(new Dictionary<Guid, UserProfileInfo>());
            _outbox.Setup(x => x.AddAsync(It.IsAny<OutboxMessage>(), It.IsAny<CancellationToken>())).Callback<OutboxMessage, CancellationToken>((m, _) => OutboxMessages.Add(m)).Returns(Task.CompletedTask);
        }

        private (IReadOnlyList<TodoItem>, int) Page(Expression<Func<TodoItem, bool>> predicate, int page, int size)
        {
            var all = Todos.Where(predicate.Compile()).ToArray();
            return (all.Skip((page - 1) * size).Take(size).ToArray(), all.Length);
        }
        public void Accept(Guid owner, Guid friend, DateTime? acceptedAt = null)
        {
            if (!_friends.TryGetValue(owner, out var a)) _friends[owner] = a = [];
            if (!_friends.TryGetValue(friend, out var b)) _friends[friend] = b = [];
            a[friend] = acceptedAt; b[owner] = acceptedAt;
        }
        public void SetViewerCategory(Guid todoId, Guid categoryId) => _preferences.Setup(x => x.GetTodoIdsByViewerCategoryAsync(ViewerId, categoryId, It.IsAny<CancellationToken>())).ReturnsAsync(new List<Guid> { todoId });
        public void Unfriend(Guid owner, Guid friend) { _friends[owner].Remove(friend); _friends[friend].Remove(owner); }
        public TodoItem Frozen(Guid owner, params Guid[] shares)
        {
            var task = TodoItem.Create(owner, "snapshot", "private description", isPublic: true, sharedWithUserIds: shares, allFriendsSnapshotAt: DateTime.UtcNow);
            Todos.Add(task); return task;
        }
        public TodoItem Legacy(Guid owner) { var task = TodoItem.Create(owner, "legacy", "legacy description", isPublic: true); Todos.Add(task); return task; }
        public CreateTodoCommandHandler Create() => new(Repository.Object, _uow, _mapper, NullLogger<CreateTodoCommandHandler>.Instance, _user.Object, _category, Friendships.Object, _outbox.Object);
        public UpdateTodoCommandHandler Update() => new(Repository.Object, _uow, _mapper, NullLogger<UpdateTodoCommandHandler>.Instance, _user.Object, _category, Friendships.Object, _preferences.Object, _outbox.Object);
        public DuplicateTodoCommandHandler Duplicate() => new(Repository.Object, _uow, _mapper, NullLogger<DuplicateTodoCommandHandler>.Instance, _user.Object, _category, Friendships.Object, _outbox.Object);
        public GetTodoByIdQueryHandler ById() => new(Repository.Object, _user.Object, _mapper, NullLogger<GetTodoByIdQueryHandler>.Instance, Friendships.Object, _category, _preferences.Object);
        public GetUserTodosQueryHandler List() => new(Repository.Object, _mapper, NullLogger<GetUserTodosQueryHandler>.Instance, _user.Object, _category, Friendships.Object, _preferences.Object);
        public GetPublicTodosQueryHandler Public() => new(Repository.Object, _mapper, NullLogger<GetPublicTodosQueryHandler>.Instance, _user.Object, Friendships.Object, _preferences.Object);
        public JoinTodoCommandHandler Join() => new(Repository.Object, _uow, _mapper, _user.Object, Friendships.Object, _outbox.Object, NullLogger<JoinTodoCommandHandler>.Instance);
        public CreateSubtaskCommandHandler Subtask() => new(Repository.Object, _uow, _mapper, NullLogger<CreateSubtaskCommandHandler>.Instance, _user.Object, Friendships.Object, _category, _outbox.Object);
        public GetSubtasksQueryHandler Subtasks() => new(Repository.Object, _user.Object, _mapper, NullLogger<GetSubtasksQueryHandler>.Instance, Friendships.Object, _category, _profiles.Object);
        public SetViewerPreferenceCommandHandler Preference() => new(Repository.Object, _uow, _user.Object, _preferences.Object, Friendships.Object, _category, NullLogger<SetViewerPreferenceCommandHandler>.Instance);
        public DeleteTodoCommandHandler Delete() => new(Repository.Object, _outbox.Object, _uow, NullLogger<DeleteTodoCommandHandler>.Instance, _user.Object, Friendships.Object);
        public TodoGrpcService Grpc() => new(Mock.Of<IMediator>(), Repository.Object, Friendships.Object, NullLogger<TodoGrpcService>.Instance);
        public async Task Run(string surface, Guid id)
        {
            switch (surface)
            {
                case "by-id": await ById().Handle(new GetTodoByIdQuery(id), default); break;
                case "join": await Join().Handle(new JoinTodoCommand(id), default); break;
                case "create-subtask": await Subtask().Handle(new CreateSubtaskCommand(id, "step"), default); break;
                case "subtasks": await Subtasks().Handle(new GetSubtasksQuery(id), default); break;
                case "duplicate": await Duplicate().Handle(new DuplicateTodoCommand(id), default); break;
                case "viewer-preference": await Preference().Handle(new SetViewerPreferenceCommand(id, HiddenByViewer: true), default); break;
                case "update": await Update().Handle(new UpdateTodoCommand(id, Status: "Done"), default); break;
            }
        }
    }
}
