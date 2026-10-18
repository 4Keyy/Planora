using System.Linq.Expressions;
using AutoMapper;
using MediatR;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Planora.BuildingBlocks.Application.Context;
using Planora.Todo.Api.Controllers;
using Planora.Todo.Application.DTOs;
using Planora.Todo.Application.Features.Todos.Queries.GetCategoryTaskCounts;
using Planora.Todo.Application.Features.Todos.Queries.GetUserTodos;
using Planora.Todo.Application.Interfaces;
using Planora.Todo.Application.Services;
using Planora.Todo.Domain.Entities;
using Planora.Todo.Domain.Enums;
using Planora.Todo.Domain.Repositories;

namespace Planora.UnitTests.Services.TodoApi.Handlers;

public sealed class GetCategoryTaskCountsTests
{
    [Fact]
    public async Task CountsOwnOpenTopLevelTasksPerCategory()
    {
        var fixture = new Fixture();
        var work = Guid.NewGuid();
        var home = Guid.NewGuid();
        fixture.AddTodo(fixture.ViewerId, work);
        fixture.AddTodo(fixture.ViewerId, work);
        fixture.AddTodo(fixture.ViewerId, home);
        fixture.AddTodo(fixture.ViewerId, null); // Uncategorized tasks count nowhere.

        var counts = await fixture.CountsAsync();

        Assert.Equal(2, counts[work]);
        Assert.Equal(1, counts[home]);
        Assert.Equal(2, counts.Count);
    }

    [Fact]
    public async Task LeavesOutDoneDeletedAndSubtasks()
    {
        var fixture = new Fixture();
        var work = Guid.NewGuid();
        var parent = fixture.AddTodo(fixture.ViewerId, work);
        fixture.AddTodo(fixture.ViewerId, work).MarkAsDone(fixture.ViewerId);
        fixture.AddTodo(fixture.ViewerId, work).MarkAsDeleted(fixture.ViewerId);
        fixture.Todos.Add(TodoItem.CreateSubtask(parent, fixture.ViewerId, "Step", null));

        var counts = await fixture.CountsAsync();

        Assert.Equal(1, Assert.Single(counts).Value);
    }

    [Fact]
    public async Task FilesSharedTasksUnderTheViewersOwnCategory()
    {
        var fixture = new Fixture();
        var friend = Guid.NewGuid();
        fixture.FriendIds.Add(friend);
        var ownersCategory = Guid.NewGuid();
        var viewersCategory = Guid.NewGuid();
        var filed = fixture.AddTodo(friend, ownersCategory, sharedWith: [fixture.ViewerId]);
        fixture.SetViewerCategory(filed, viewersCategory);
        fixture.AddTodo(friend, ownersCategory, sharedWith: [fixture.ViewerId]); // Never filed by the viewer.

        var counts = await fixture.CountsAsync();

        Assert.Equal(1, Assert.Single(counts, pair => pair.Key == viewersCategory).Value);
        Assert.False(counts.ContainsKey(ownersCategory));
    }

    [Fact]
    public async Task LeavesOutSharedTasksTheViewerCompletedOrCanNoLongerSee()
    {
        var fixture = new Fixture();
        var friend = Guid.NewGuid();
        var former = Guid.NewGuid();
        fixture.FriendIds.Add(friend);
        var category = Guid.NewGuid();
        var completedByViewer = fixture.AddTodo(friend, null, sharedWith: [fixture.ViewerId]);
        fixture.SetViewerCategory(completedByViewer, category, completed: true);
        var fromFormerFriend = fixture.AddTodo(former, null, sharedWith: [fixture.ViewerId]);
        fixture.SetViewerCategory(fromFormerFriend, category);
        var stillOpen = fixture.AddTodo(friend, null, sharedWith: [fixture.ViewerId]);
        fixture.SetViewerCategory(stillOpen, category);

        var counts = await fixture.CountsAsync();

        Assert.Equal(1, counts[category]);
    }

    [Fact]
    public async Task OwnTaskKeepsItsOwnCategoryEvenWithAViewerPreference()
    {
        var fixture = new Fixture();
        var friend = Guid.NewGuid();
        fixture.FriendIds.Add(friend);
        var category = Guid.NewGuid();
        var own = fixture.AddTodo(fixture.ViewerId, category, sharedWith: [friend]);
        fixture.SetViewerCategory(own, Guid.NewGuid(), hidden: true);

        var counts = await fixture.CountsAsync();

        Assert.Equal(1, Assert.Single(counts, pair => pair.Key == category).Value);
        Assert.Single(counts);
    }

    [Fact]
    public async Task EachCountEqualsTheActiveListTotalForThatCategory()
    {
        var fixture = new Fixture();
        var friend = Guid.NewGuid();
        fixture.FriendIds.Add(friend);
        var work = Guid.NewGuid();
        var home = Guid.NewGuid();
        fixture.AddTodo(fixture.ViewerId, work);
        fixture.AddTodo(fixture.ViewerId, work).SetHidden(true, fixture.ViewerId);
        fixture.AddTodo(fixture.ViewerId, home).MarkAsDone(fixture.ViewerId);
        var shared = fixture.AddTodo(friend, Guid.NewGuid(), sharedWith: [fixture.ViewerId]);
        fixture.SetViewerCategory(shared, home, hidden: true);
        var sharedDone = fixture.AddTodo(friend, Guid.NewGuid(), sharedWith: [fixture.ViewerId]);
        fixture.SetViewerCategory(sharedDone, work, completed: true);
        var publicFiled = fixture.AddTodo(friend, Guid.NewGuid(), isPublic: true);
        fixture.SetViewerCategory(publicFiled, work);

        var counts = await fixture.CountsAsync();

        foreach (var category in new[] { work, home })
        {
            var list = await fixture.ListHandler.Handle(
                new GetUserTodosQuery(null, PageSize: 100, CategoryId: category, IsCompleted: false),
                CancellationToken.None);
            Assert.Equal(list.TotalCount, counts.GetValueOrDefault(category));
        }
    }

    [Fact]
    public async Task RejectsAMissingUserContext()
    {
        var fixture = new Fixture(Guid.Empty);

        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => fixture.CountsAsync());
    }

    [Fact]
    public async Task ControllerSendsTheQueryAndReturnsItsResult()
    {
        var mediator = new Mock<IMediator>();
        IReadOnlyList<CategoryTaskCountDto> response = [new() { CategoryId = Guid.NewGuid(), OpenCount = 3 }];
        CancellationToken sentToken = default;
        mediator.Setup(m => m.Send(It.IsAny<GetCategoryTaskCountsQuery>(), It.IsAny<CancellationToken>()))
            .Callback<IRequest<IReadOnlyList<CategoryTaskCountDto>>, CancellationToken>((_, token) => sentToken = token)
            .ReturnsAsync(response);
        var controller = new TodosController(mediator.Object, NullLogger<TodosController>.Instance);
        using var cancellation = new CancellationTokenSource();

        var result = await controller.GetCategoryTaskCounts(cancellation.Token);

        Assert.Same(response, Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal(cancellation.Token, sentToken);
    }

    private sealed class Fixture
    {
        public Guid ViewerId { get; }
        public List<Guid> FriendIds { get; } = [];
        public List<TodoItem> Todos { get; } = [];
        public Dictionary<Guid, UserTodoViewPreference> Preferences { get; } = [];
        public GetCategoryTaskCountsQueryHandler Handler { get; }
        public GetUserTodosQueryHandler ListHandler { get; }

        public Fixture(Guid? viewerId = null)
        {
            ViewerId = viewerId ?? Guid.NewGuid();
            var repository = new Mock<ITodoRepository>();
            repository.Setup(r => r.GetCategoryKeysAsync(It.IsAny<Expression<Func<TodoItem, bool>>>(), It.IsAny<CancellationToken>()))
                .ReturnsAsync((Expression<Func<TodoItem, bool>> predicate, CancellationToken _) =>
                    (IReadOnlyList<TodoCategoryKey>)Todos.Where(predicate.Compile())
                        .Select(t => new TodoCategoryKey(t.Id, t.UserId, t.CategoryId)).ToList());
            repository.Setup(r => r.GetPagedWithIncludesAsync(It.IsAny<Expression<Func<TodoItem, bool>>>(), It.IsAny<int>(), It.IsAny<int>(), It.IsAny<bool>(), It.IsAny<Guid?>(), It.IsAny<CancellationToken>()))
                .ReturnsAsync((Expression<Func<TodoItem, bool>> predicate, int page, int size, bool _, Guid? _, CancellationToken _) =>
                {
                    var matching = Todos.Where(predicate.Compile()).ToArray();
                    return ((IReadOnlyList<TodoItem>)matching.Skip((page - 1) * size).Take(size).ToArray(), matching.Length);
                });
            repository.Setup(r => r.GetOpenSubtaskCountsAsync(It.IsAny<IReadOnlyCollection<Guid>>(), It.IsAny<CancellationToken>()))
                .ReturnsAsync(new Dictionary<Guid, int>());

            var preferences = new Mock<IUserTodoViewPreferenceRepository>();
            preferences.Setup(p => p.GetViewerCategoryAssignmentsAsync(ViewerId, It.IsAny<CancellationToken>()))
                .ReturnsAsync(() => (IReadOnlyDictionary<Guid, Guid>)Preferences.Values
                    .Where(p => p.ViewerCategoryId.HasValue)
                    .ToDictionary(p => p.TodoItemId, p => p.ViewerCategoryId!.Value));
            preferences.Setup(p => p.GetCompletedTodoIdsByViewerAsync(ViewerId, It.IsAny<CancellationToken>()))
                .ReturnsAsync(() => Preferences.Values.Where(p => p.CompletedByViewer).Select(p => p.TodoItemId).ToList());
            preferences.Setup(p => p.GetHiddenTodoIdsAsync(ViewerId, It.IsAny<CancellationToken>()))
                .ReturnsAsync(() => Preferences.Values.Where(p => p.HiddenByViewer).Select(p => p.TodoItemId).ToList());
            preferences.Setup(p => p.GetTodoIdsByViewerCategoryAsync(ViewerId, It.IsAny<Guid>(), It.IsAny<CancellationToken>()))
                .ReturnsAsync((Guid _, Guid category, CancellationToken _) =>
                    Preferences.Values.Where(p => p.ViewerCategoryId == category).Select(p => p.TodoItemId).ToList());
            preferences.Setup(p => p.GetByViewerIdForTodosAsync(ViewerId, It.IsAny<IReadOnlyCollection<Guid>>(), It.IsAny<CancellationToken>()))
                .ReturnsAsync(() => (IReadOnlyDictionary<Guid, UserTodoViewPreference>)Preferences);

            var currentUser = new Mock<ICurrentUserContext>();
            currentUser.SetupGet(context => context.UserId).Returns(ViewerId);
            var friendship = new Mock<IFriendshipService>();
            friendship.Setup(f => f.GetFriendshipsAsync(ViewerId, It.IsAny<CancellationToken>()))
                .ReturnsAsync(() => (IReadOnlyList<FriendshipInfo>)FriendIds.Select(id => new FriendshipInfo(id, null)).ToArray());
            var categoryClient = new Mock<ICategoryGrpcClient>();

            Handler = new GetCategoryTaskCountsQueryHandler(repository.Object, preferences.Object, friendship.Object,
                currentUser.Object, NullLogger<GetCategoryTaskCountsQueryHandler>.Instance);
            var mapper = new MapperConfiguration(cfg => cfg.AddProfile<TodoItemMappingProfile>(), NullLoggerFactory.Instance).CreateMapper();
            ListHandler = new GetUserTodosQueryHandler(repository.Object, mapper, NullLogger<GetUserTodosQueryHandler>.Instance,
                currentUser.Object, categoryClient.Object, friendship.Object, preferences.Object);
        }

        public async Task<Dictionary<Guid, int>> CountsAsync() =>
            (await Handler.Handle(new GetCategoryTaskCountsQuery(), CancellationToken.None))
                .ToDictionary(c => c.CategoryId, c => c.OpenCount);

        public TodoItem AddTodo(Guid ownerId, Guid? categoryId, IEnumerable<Guid>? sharedWith = null, bool isPublic = false)
        {
            var todo = TodoItem.Create(ownerId, "Task", categoryId: categoryId, priority: TodoPriority.Medium,
                isPublic: isPublic, sharedWithUserIds: sharedWith);
            Todos.Add(todo);
            return todo;
        }

        public void SetViewerCategory(TodoItem todo, Guid categoryId, bool completed = false, bool hidden = false) =>
            Preferences[todo.Id] = new UserTodoViewPreference
            {
                ViewerId = ViewerId, TodoItemId = todo.Id, ViewerCategoryId = categoryId, HiddenByViewer = hidden,
                CompletedByViewer = completed, CompletedByViewerAt = completed ? DateTime.UtcNow : null,
            };
    }
}
