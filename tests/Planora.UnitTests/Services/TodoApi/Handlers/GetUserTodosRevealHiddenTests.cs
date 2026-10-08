using System.Linq.Expressions;
using System.Reflection;
using System.Text.Json;
using AutoMapper;
using MediatR;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Planora.BuildingBlocks.Application.Context;
using Planora.BuildingBlocks.Application.Pagination;
using Planora.Todo.Api.Controllers;
using Planora.Todo.Application.DTOs;
using Planora.Todo.Application.Features.Todos.Queries.GetUserTodos;
using Planora.Todo.Application.Interfaces;
using Planora.Todo.Application.Services;
using Planora.Todo.Domain.Entities;
using Planora.Todo.Domain.Enums;
using Planora.Todo.Domain.Repositories;

namespace Planora.UnitTests.Services.TodoApi.Handlers;

public sealed class GetUserTodosRevealHiddenTests
{
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task DefaultFlag_KeepsHiddenFriendTaskMasked(bool isPublic)
    {
        var fixture = new Fixture();
        var ownerId = Guid.NewGuid();
        var task = fixture.AddRichTodo(ownerId, [fixture.ViewerId], isPublic);
        fixture.FriendIds.Add(ownerId);
        fixture.SetPreference(task, hidden: true);

        var result = await fixture.Handler.Handle(new GetUserTodosQuery(null), CancellationToken.None);

        var dto = Assert.Single(result.Items);
        Assert.Equal("Hidden task", dto.Title);
        Assert.Equal(Guid.Empty, dto.UserId);
        Assert.True(dto.Hidden);
        Assert.Null(dto.Description);
        Assert.Null(dto.DueDate);
        Assert.Null(dto.DueDateStart);
        Assert.Null(dto.ExpectedDate);
        Assert.Null(dto.ActualDate);
        Assert.Empty(dto.Tags);
        Assert.Empty(dto.SharedWithUserIds);
        Assert.Empty(dto.WorkerUserIds);
        Assert.Equal(0, dto.WorkerCount);
        Assert.Null(dto.RequiredWorkers);
        Assert.Equal(DateTime.MinValue, dto.CreatedAt);
        Assert.Equal(fixture.ViewerCategory.Id, dto.CategoryId);
        Assert.Equal(fixture.ViewerCategory.Name, dto.CategoryName);
    }

    [Fact]
    public async Task DefaultFlag_KeepsPrivateOwnerHiddenShapeUnchanged()
    {
        var fixture = new Fixture();
        var task = fixture.AddRichTodo(fixture.ViewerId);
        task.SetHidden(true, fixture.ViewerId);

        var result = await fixture.Handler.Handle(new GetUserTodosQuery(null), CancellationToken.None);

        var dto = Assert.Single(result.Items);
        Assert.Equal(task.Title, dto.Title);
        Assert.Equal(task.UserId, dto.UserId);
        Assert.True(dto.Hidden);
        Assert.Null(dto.Description);
        Assert.Null(dto.DueDate);
        Assert.Null(dto.DueDateStart);
        Assert.Null(dto.ExpectedDate);
        Assert.Null(dto.ActualDate);
        Assert.Empty(dto.Tags);
        Assert.Equal(task.CategoryId, dto.CategoryId);
        Assert.Equal("Owner category", dto.CategoryName);
        Assert.Equal(task.CreatedAt, dto.CreatedAt);
    }

    [Fact]
    public async Task RevealHidden_ReturnsFullFriendTaskWithViewerCategoryAndWorkers()
    {
        var fixture = new Fixture();
        var ownerId = Guid.NewGuid();
        var task = fixture.AddRichTodo(ownerId, [fixture.ViewerId, Guid.NewGuid()]);
        task.SetRequiredWorkers(3, ownerId);
        task.AddWorker(fixture.ViewerId);
        fixture.OpenCounts[task.Id] = 2;
        fixture.FriendIds.Add(ownerId);
        fixture.SetPreference(task, hidden: true);

        var result = await fixture.Handler.Handle(new GetUserTodosQuery(null, RevealHidden: true), CancellationToken.None);

        var dto = Assert.Single(result.Items);
        AssertFullData(task, dto);
        Assert.True(dto.Hidden);
        Assert.Equal(fixture.ViewerCategory.Id, dto.CategoryId);
        Assert.Equal(fixture.ViewerCategory.Name, dto.CategoryName);
        Assert.Equal(fixture.ViewerCategory.Color, dto.CategoryColor);
        Assert.Equal(fixture.ViewerCategory.Icon, dto.CategoryIcon);
        Assert.Equal("Owner category", dto.AuthorCategoryName);
        Assert.Equal(1, dto.WorkerCount);
        Assert.Equal(new[] { fixture.ViewerId }, dto.WorkerUserIds);
        Assert.True(dto.IsWorking);
        Assert.Equal(3, dto.RequiredWorkers);
        Assert.Equal(2, dto.OpenSubtaskCount);
        Assert.Equal(task.SharedWith.Select(share => share.SharedWithUserId), dto.SharedWithUserIds);
    }

    [Fact]
    public async Task RevealHidden_ReturnsFullPrivateOwnerTaskAndKeepsHiddenTrue()
    {
        var fixture = new Fixture();
        var task = fixture.AddRichTodo(fixture.ViewerId);
        task.SetHidden(true, fixture.ViewerId);

        var result = await fixture.Handler.Handle(new GetUserTodosQuery(null, RevealHidden: true), CancellationToken.None);

        var dto = Assert.Single(result.Items);
        AssertFullData(task, dto);
        Assert.True(dto.Hidden);
        Assert.Equal(task.CategoryId, dto.CategoryId);
        Assert.Equal("Owner category", dto.CategoryName);
        Assert.Empty(dto.WorkerUserIds);
        Assert.Empty(dto.SharedWithUserIds);
        Assert.False(dto.IsPublic);
    }

    [Fact]
    public async Task RevealHidden_UsesTheSameFullDtoAsVisibleTasks()
    {
        var fixture = new Fixture();
        var ownerId = Guid.NewGuid();
        var task = fixture.AddRichTodo(ownerId, [fixture.ViewerId]);
        fixture.FriendIds.Add(ownerId);
        fixture.SetPreference(task, hidden: false);
        var visible = Assert.Single((await fixture.Handler.Handle(new GetUserTodosQuery(null), CancellationToken.None)).Items);

        fixture.Preferences[task.Id].HiddenByViewer = true;
        var revealed = Assert.Single((await fixture.Handler.Handle(new GetUserTodosQuery(null, RevealHidden: true), CancellationToken.None)).Items);

        Assert.Equal(JsonSerializer.Serialize(visible), JsonSerializer.Serialize(revealed with { Hidden = false }));
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Flag_DoesNotAddUnauthorizedRowsOrChangePaging(bool revealHidden)
    {
        var fixture = new Fixture();
        var ownerId = Guid.NewGuid();
        fixture.FriendIds.Add(ownerId);
        var own = fixture.AddRichTodo(fixture.ViewerId);
        var shared = fixture.AddRichTodo(ownerId, [fixture.ViewerId]);
        fixture.SetPreference(shared, hidden: true);
        fixture.AddRichTodo(ownerId); // A friend's private task is still inaccessible.
        fixture.AddRichTodo(Guid.NewGuid(), [fixture.ViewerId], isPublic: true); // Shares never waive live friendship.
        fixture.AddRichTodo(Guid.NewGuid(), isPublic: true);

        var first = await fixture.Handler.Handle(new GetUserTodosQuery(null, PageNumber: 1, PageSize: 1, RevealHidden: revealHidden), CancellationToken.None);
        var second = await fixture.Handler.Handle(new GetUserTodosQuery(null, PageNumber: 2, PageSize: 1, RevealHidden: revealHidden), CancellationToken.None);

        Assert.Equal(2, first.TotalCount);
        Assert.Equal(2, second.TotalCount);
        Assert.Equal(own.Id, Assert.Single(first.Items).Id);
        Assert.Equal(shared.Id, Assert.Single(second.Items).Id);
        Assert.Equal(1, first.PageNumber);
        Assert.Equal(2, second.PageNumber);
        Assert.Equal(1, second.PageSize);
        Assert.Equal(2, second.TotalPages);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Flag_NeverRestoresHiddenSharedRowsToCompletedArchive(bool revealHidden)
    {
        var fixture = new Fixture();
        var ownerId = Guid.NewGuid();
        fixture.FriendIds.Add(ownerId);
        var privateCompleted = fixture.AddRichTodo(fixture.ViewerId);
        privateCompleted.SetHidden(true, fixture.ViewerId);
        privateCompleted.MarkAsDone(fixture.ViewerId);
        var viewerCompletedHidden = fixture.AddRichTodo(ownerId, [fixture.ViewerId]);
        fixture.SetPreference(viewerCompletedHidden, hidden: true, completed: true);
        var ownSharedHidden = fixture.AddRichTodo(fixture.ViewerId, [ownerId]);
        ownSharedHidden.SetHidden(true, fixture.ViewerId);
        ownSharedHidden.MarkAsDone(fixture.ViewerId);
        var visibleCompleted = fixture.AddRichTodo(fixture.ViewerId);
        visibleCompleted.MarkAsDone(fixture.ViewerId);

        var result = await fixture.Handler.Handle(new GetUserTodosQuery(null, IsCompleted: true, RevealHidden: revealHidden), CancellationToken.None);

        Assert.Equal(2, result.TotalCount);
        Assert.Equal(new[] { privateCompleted.Id, visibleCompleted.Id }, result.Items.Select(dto => dto.Id));
        Assert.True(result.Items[0].Hidden);
    }

    [Fact]
    public void Query_OldPositionalCallersKeepRevealHiddenDisabled()
    {
        var from = DateTime.UtcNow.AddDays(-1);
        var to = DateTime.UtcNow;
        var query = new GetUserTodosQuery(Guid.NewGuid(), 2, 25, "done", Guid.NewGuid(), true, true, from, to);

        Assert.False(query.RevealHidden);
        Assert.Equal(from, query.CompletedFrom);
        Assert.Equal(to, query.CompletedTo);
        var tail = typeof(GetUserTodosQuery).GetConstructors().Single().GetParameters().Last();
        Assert.Equal("RevealHidden", tail.Name);
        Assert.Equal(false, tail.DefaultValue);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Controller_PassesFlagAndKeepsEveryExistingFilter(bool revealHidden)
    {
        var mediator = new Mock<IMediator>();
        var response = PagedResult<TodoItemDto>.Empty(3, 25);
        GetUserTodosQuery? sent = null;
        CancellationToken sentToken = default;
        mediator.Setup(m => m.Send(It.IsAny<GetUserTodosQuery>(), It.IsAny<CancellationToken>()))
            .Callback<IRequest<PagedResult<TodoItemDto>>, CancellationToken>((query, token) => { sent = (GetUserTodosQuery)query; sentToken = token; })
            .ReturnsAsync(response);
        var controller = new TodosController(mediator.Object, NullLogger<TodosController>.Instance);
        var category = Guid.NewGuid();
        var from = DateTime.UtcNow.AddDays(-7);
        var to = DateTime.UtcNow;
        using var cancellation = new CancellationTokenSource();

        var result = await controller.GetTodos(3, 25, "done", category, true, true, from, to, cancellation.Token, revealHidden);

        Assert.Same(response, Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.NotNull(sent);
        Assert.Null(sent.UserId);
        Assert.Equal(3, sent.PageNumber);
        Assert.Equal(25, sent.PageSize);
        Assert.Equal("done", sent.Status);
        Assert.Equal(category, sent.CategoryId);
        Assert.True(sent.IsCompleted);
        Assert.True(sent.IncludeSubtasks);
        Assert.Equal(from, sent.CompletedFrom);
        Assert.Equal(to, sent.CompletedTo);
        Assert.Equal(revealHidden, sent.RevealHidden);
        Assert.Equal(cancellation.Token, sentToken);
        var flag = typeof(TodosController).GetMethod(nameof(TodosController.GetTodos))!.GetParameters().Single(parameter => parameter.Name == "revealHidden");
        Assert.NotNull(flag.GetCustomAttribute<FromQueryAttribute>());
        Assert.Equal(false, flag.DefaultValue);
    }

    [Fact]
    public async Task Controller_OmittedFlagStaysFalseForExistingPositionalCallers()
    {
        var mediator = new Mock<IMediator>();
        GetUserTodosQuery? sent = null;
        mediator.Setup(m => m.Send(It.IsAny<GetUserTodosQuery>(), It.IsAny<CancellationToken>()))
            .Callback<IRequest<PagedResult<TodoItemDto>>, CancellationToken>((query, _) => sent = (GetUserTodosQuery)query)
            .ReturnsAsync(PagedResult<TodoItemDto>.Empty(1, 10));
        var controller = new TodosController(mediator.Object, NullLogger<TodosController>.Instance);

        await controller.GetTodos(1, 10, null, null, null, false, null, null, CancellationToken.None);

        Assert.NotNull(sent);
        Assert.False(sent.RevealHidden);
    }

    private static void AssertFullData(TodoItem task, TodoItemDto dto)
    {
        Assert.Equal(task.Id, dto.Id);
        Assert.Equal(task.UserId, dto.UserId);
        Assert.Equal(task.Title, dto.Title);
        Assert.Equal(task.Description, dto.Description);
        Assert.Equal(task.DueDate, dto.DueDate);
        Assert.Equal(task.DueDateStart, dto.DueDateStart);
        Assert.Equal(task.ExpectedDate, dto.ExpectedDate);
        Assert.Equal(task.Priority.ToString(), dto.Priority);
        Assert.Equal(task.CreatedAt, dto.CreatedAt);
        Assert.Equal(task.UpdatedAt, dto.UpdatedAt);
        Assert.Equal(task.Tags.Select(tag => tag.Name), dto.Tags);
    }

    private sealed class Fixture
    {
        public Guid ViewerId { get; } = Guid.NewGuid();
        public List<Guid> FriendIds { get; } = [];
        public List<TodoItem> Todos { get; } = [];
        public Dictionary<Guid, UserTodoViewPreference> Preferences { get; } = [];
        public Dictionary<Guid, int> OpenCounts { get; } = [];
        public CategoryInfo ViewerCategory { get; }
        private readonly Dictionary<Guid, CategoryInfo> _categories = [];
        public GetUserTodosQueryHandler Handler { get; }

        public Fixture()
        {
            ViewerCategory = new CategoryInfo(Guid.NewGuid(), ViewerId, "Viewer category", "#778899", "Book");
            _categories[ViewerCategory.Id] = ViewerCategory;
            var repository = new Mock<ITodoRepository>();
            repository.Setup(r => r.GetPagedWithIncludesAsync(It.IsAny<Expression<Func<TodoItem, bool>>>(), It.IsAny<int>(), It.IsAny<int>(), It.IsAny<bool>(), It.IsAny<Guid?>(), It.IsAny<CancellationToken>()))
                .ReturnsAsync((Expression<Func<TodoItem, bool>> predicate, int page, int size, bool _, Guid? _, CancellationToken _) =>
                {
                    var matching = Todos.Where(predicate.Compile()).ToArray();
                    return ((IReadOnlyList<TodoItem>)matching.Skip((page - 1) * size).Take(size).ToArray(), matching.Length);
                });
            repository.Setup(r => r.GetOpenSubtaskCountsAsync(It.IsAny<IReadOnlyCollection<Guid>>(), It.IsAny<CancellationToken>()))
                .ReturnsAsync(() => (IReadOnlyDictionary<Guid, int>)OpenCounts);
            var preferences = new Mock<IUserTodoViewPreferenceRepository>();
            preferences.Setup(p => p.GetByViewerIdForTodosAsync(ViewerId, It.IsAny<IReadOnlyCollection<Guid>>(), It.IsAny<CancellationToken>()))
                .ReturnsAsync(() => (IReadOnlyDictionary<Guid, UserTodoViewPreference>)Preferences);
            preferences.Setup(p => p.GetCompletedTodoIdsByViewerAsync(ViewerId, It.IsAny<CancellationToken>()))
                .ReturnsAsync(() => Preferences.Values.Where(p => p.CompletedByViewer).Select(p => p.TodoItemId).ToList());
            preferences.Setup(p => p.GetHiddenTodoIdsAsync(ViewerId, It.IsAny<CancellationToken>()))
                .ReturnsAsync(() => Preferences.Values.Where(p => p.HiddenByViewer).Select(p => p.TodoItemId).ToList());
            preferences.Setup(p => p.GetTodoIdsByViewerCategoryAsync(ViewerId, It.IsAny<Guid>(), It.IsAny<CancellationToken>()))
                .ReturnsAsync((Guid _, Guid category, CancellationToken _) => Preferences.Values.Where(p => p.ViewerCategoryId == category).Select(p => p.TodoItemId).ToList());
            var currentUser = new Mock<ICurrentUserContext>();
            currentUser.SetupGet(context => context.UserId).Returns(ViewerId);
            var friendship = new Mock<IFriendshipService>();
            friendship.Setup(f => f.GetFriendshipsAsync(ViewerId, It.IsAny<CancellationToken>()))
                .ReturnsAsync(() => (IReadOnlyList<FriendshipInfo>)FriendIds.Select(id => new FriendshipInfo(id, null)).ToArray());
            var categoryClient = new Mock<ICategoryGrpcClient>();
            categoryClient.Setup(c => c.GetCategoryInfoAsync(It.IsAny<Guid>(), It.IsAny<Guid>(), It.IsAny<CancellationToken>()))
                .ReturnsAsync((Guid category, Guid userId, CancellationToken _) => _categories.TryGetValue(category, out var info) && info.UserId == userId ? info : null);
            var mapper = new MapperConfiguration(cfg => cfg.AddProfile<TodoItemMappingProfile>(), NullLoggerFactory.Instance).CreateMapper();
            Handler = new GetUserTodosQueryHandler(repository.Object, mapper, NullLogger<GetUserTodosQueryHandler>.Instance,
                currentUser.Object, categoryClient.Object, friendship.Object, preferences.Object);
        }

        public TodoItem AddRichTodo(Guid ownerId, IEnumerable<Guid>? shared = null, bool isPublic = false)
        {
            var category = new CategoryInfo(Guid.NewGuid(), ownerId, "Owner category", "#112233", "Folder");
            _categories[category.Id] = category;
            var task = TodoItem.Create(ownerId, "Real title", "Real description", category.Id,
                dueDate: new DateTime(2026, 11, 2, 0, 0, 0, DateTimeKind.Utc),
                dueDateStart: new DateTime(2026, 11, 1, 0, 0, 0, DateTimeKind.Utc),
                expectedDate: new DateTime(2026, 11, 3, 0, 0, 0, DateTimeKind.Utc),
                priority: TodoPriority.High, isPublic: isPublic, sharedWithUserIds: shared);
            task.AddTag("searchable", ownerId);
            Todos.Add(task);
            return task;
        }

        public void SetPreference(TodoItem task, bool hidden, bool completed = false) => Preferences[task.Id] = new UserTodoViewPreference
        {
            ViewerId = ViewerId, TodoItemId = task.Id, HiddenByViewer = hidden, ViewerCategoryId = ViewerCategory.Id,
            CompletedByViewer = completed, CompletedByViewerAt = completed ? DateTime.UtcNow : null,
        };
    }
}
