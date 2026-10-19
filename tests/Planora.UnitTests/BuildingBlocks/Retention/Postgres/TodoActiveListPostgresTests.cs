using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Planora.Todo.Domain.Entities;
using Planora.Todo.Domain.Enums;
using Planora.Todo.Infrastructure.Persistence;
using Planora.Todo.Infrastructure.Persistence.Repositories;
using Testcontainers.PostgreSql;
using static Planora.UnitTests.BuildingBlocks.Retention.Postgres.RetentionTestKit;

namespace Planora.UnitTests.BuildingBlocks.Retention.Postgres;

/// <summary>Exercises the active list's correlated ordering and paging on PostgreSQL.</summary>
[Trait("TestType", "Integration")]
public sealed class TodoActiveListPostgresTests(TodoActiveListPostgresFixture fixture)
    : IClassFixture<TodoActiveListPostgresFixture>
{
    private static readonly DateTime UtcNow = new(2026, 10, 19, 12, 0, 0, DateTimeKind.Utc);

    [Fact]
    public async Task ActiveList_UsesTheViewersEffectiveHiddenState()
    {
        await using var db = fixture.CreateContext();
        var viewer = Guid.NewGuid();
        var friend = Guid.NewGuid();
        var now = UtcNow;
        var ownPrivateHidden = Create(viewer, "own private hidden", now, hidden: true);
        var friendViewerHidden = Create(friend, "friend hidden by viewer", now.AddHours(-1), sharedWith: viewer);
        var ownSharedHidden = Create(viewer, "own shared legacy hidden", now.AddHours(-2), hidden: true, sharedWith: friend);
        var ownPreferenceHidden = Create(viewer, "own public preference hidden", now.AddHours(-3), isPublic: true);
        var friendPublicHidden = Create(friend, "public hidden by viewer", now.AddHours(-4), isPublic: true);
        var friendOwnerHidden = Create(friend, "friend hidden only by owner", now.AddHours(-5), hidden: true, sharedWith: viewer);
        var privatePreferenceIgnored = Create(viewer, "private ignores preference", now.AddHours(-6));
        var otherViewerIgnored = Create(friend, "another viewer hides it", now.AddHours(-7), sharedWith: viewer);
        var open = Create(viewer, "oldest open", now.AddHours(-8));
        var todos = new[] { ownPrivateHidden, friendViewerHidden, ownSharedHidden, ownPreferenceHidden,
            friendPublicHidden, friendOwnerHidden, privatePreferenceIgnored, otherViewerIgnored, open };

        await SeedAsync(db, todos,
            HiddenPreference(viewer, friendViewerHidden),
            HiddenPreference(viewer, ownPreferenceHidden),
            HiddenPreference(viewer, friendPublicHidden),
            HiddenPreference(viewer, privatePreferenceIgnored),
            HiddenPreference(Guid.NewGuid(), otherViewerIgnored),
            new UserTodoViewPreference { ViewerId = viewer, TodoItemId = friendOwnerHidden.Id });

        var page = await PageAsync(db, todos, viewer);

        page.TotalCount.Should().Be(todos.Length);
        page.Items.Select(t => t.Id).Should().Equal(friendOwnerHidden.Id, privatePreferenceIgnored.Id,
            otherViewerIgnored.Id, open.Id, ownPrivateHidden.Id, friendViewerHidden.Id,
            ownSharedHidden.Id, ownPreferenceHidden.Id, friendPublicHidden.Id);
        page.Items.Single(t => t.Id == friendViewerHidden.Id).SharedWith
            .Should().ContainSingle(s => s.SharedWithUserId == viewer);
    }

    [Fact]
    public async Task ActiveList_PrioritizesUrgencyOnlyAmongHiddenTasks_UsingTheUtcDay()
    {
        await using var db = fixture.CreateContext();
        var viewer = Guid.NewGuid();
        var today = UtcNow.Date;
        var hiddenNormal = Create(viewer, "hidden normal", today.AddHours(-1), hidden: true);
        var hiddenTomorrow = Create(viewer, "due tomorrow at midnight", today.AddHours(-2), hidden: true,
            dueDate: today.AddDays(1));
        var hiddenDone = Create(viewer, "done is never urgent", today.AddHours(-3), hidden: true,
            priority: TodoPriority.Urgent, dueDate: today.AddDays(-1));
        hiddenDone.MarkAsDone(viewer);
        var hiddenUrgent = Create(Guid.NewGuid(), "hidden urgent priority", today.AddHours(-4), sharedWith: viewer,
            priority: TodoPriority.Urgent);
        var hiddenOverdue = Create(viewer, "hidden due yesterday", today.AddHours(-5), hidden: true,
            dueDate: today.AddDays(-1));
        var hiddenToday = Create(viewer, "hidden due late today", today.AddHours(-6), hidden: true,
            dueDate: today.AddDays(1).AddSeconds(-1));
        var openNew = Create(viewer, "newest open, normal", today.AddHours(-7));
        var openUrgent = Create(viewer, "older open, urgent", today.AddHours(-8), priority: TodoPriority.Urgent);
        var openOverdue = Create(viewer, "oldest open, overdue", today.AddHours(-9), dueDate: today.AddDays(-1));
        var todos = new[] { hiddenNormal, hiddenTomorrow, hiddenDone, hiddenUrgent, hiddenOverdue,
            hiddenToday, openNew, openUrgent, openOverdue };
        await SeedAsync(db, todos, HiddenPreference(viewer, hiddenUrgent));

        var page = await PageAsync(db, todos, viewer);

        page.Items.Select(t => t.Id).Should().Equal(openNew.Id, openUrgent.Id, openOverdue.Id,
            hiddenUrgent.Id, hiddenOverdue.Id, hiddenToday.Id, hiddenNormal.Id, hiddenTomorrow.Id, hiddenDone.Id);
        page.Items.Single(t => t.Id == hiddenToday.Id).DueDate!.Value.Kind.Should().Be(DateTimeKind.Utc);
    }

    [Fact]
    public async Task ActiveList_PagesOpenTasksBeforeHiddenTasks_WithStableIdTies()
    {
        await using var db = fixture.CreateContext();
        var viewer = Guid.NewGuid();
        var now = UtcNow;
        var open = Enumerable.Range(0, 5).Select(i => Create(viewer, $"open {i}", now.AddDays(-1))).ToArray();
        var hidden = Enumerable.Range(0, 3).Select(i => Create(viewer, $"hidden {i}", now, hidden: true)).ToArray();
        var todos = hidden.Concat(open).ToArray();
        await SeedAsync(db, todos);
        var expected = open.OrderBy(t => t.Id).Concat(hidden.OrderBy(t => t.Id)).Select(t => t.Id).ToArray();
        var allIds = new List<Guid>();

        for (var pageNumber = 1; pageNumber <= 4; pageNumber++)
        {
            var page = await PageAsync(db, todos, viewer, pageNumber, pageSize: 2);
            page.TotalCount.Should().Be(todos.Length);
            page.Items.Select(t => t.Id).Should().Equal(expected.Skip((pageNumber - 1) * 2).Take(2));
            if (pageNumber == 1)
                page.Items.Should().OnlyContain(t => !t.Hidden);
            if (pageNumber == 4)
                page.Items.Should().OnlyContain(t => t.Hidden);
            allIds.AddRange(page.Items.Select(t => t.Id));
        }

        allIds.Should().Equal(expected).And.OnlyHaveUniqueItems();
        var repeated = await PageAsync(db, todos, viewer, pageNumber: 1, pageSize: 2);
        repeated.Items.Select(t => t.Id).Should().Equal(expected.Take(2));
    }

    [Fact]
    public async Task ActiveList_WithoutViewer_OrdersOnlyByCreatedAtAndId()
    {
        await using var db = fixture.CreateContext();
        var owner = Guid.NewGuid();
        var now = UtcNow;
        var newestHidden = Create(owner, "newest hidden", now, hidden: true);
        var open = Create(owner, "open", now.AddDays(-1));
        var tiedHidden = Create(owner, "hidden tied with open", now.AddDays(-1), hidden: true);
        var oldestUrgent = Create(owner, "oldest urgent", now.AddDays(-2), hidden: true, priority: TodoPriority.Urgent);
        var todos = new[] { newestHidden, open, tiedHidden, oldestUrgent };
        await SeedAsync(db, todos);
        var expected = new[] { newestHidden }.Concat(new[] { open, tiedHidden }.OrderBy(t => t.Id))
            .Append(oldestUrgent).Select(t => t.Id).ToArray();

        var first = await PageAsync(db, todos, viewerId: null, pageNumber: 1, pageSize: 2);
        var last = await PageAsync(db, todos, viewerId: null, pageNumber: 2, pageSize: 2);

        first.TotalCount.Should().Be(todos.Length);
        first.Items.Concat(last.Items).Select(t => t.Id).Should().Equal(expected);
    }

    private static TodoItem Create(Guid owner, string title, DateTime createdAt, bool hidden = false,
        bool isPublic = false, Guid? sharedWith = null, TodoPriority priority = TodoPriority.Medium, DateTime? dueDate = null)
    {
        var todo = TodoItem.Create(owner, title, priority: priority, dueDate: dueDate, isPublic: isPublic,
            sharedWithUserIds: sharedWith.HasValue ? new[] { sharedWith.Value } : null);
        if (hidden)
            todo.SetHidden(true, owner);
        Set(todo, nameof(TodoItem.CreatedAt), createdAt);
        return todo;
    }

    private static UserTodoViewPreference HiddenPreference(Guid viewer, TodoItem todo) =>
        new() { ViewerId = viewer, TodoItemId = todo.Id, HiddenByViewer = true };

    private static async Task SeedAsync(TodoDbContext db, TodoItem[] todos, params UserTodoViewPreference[] preferences)
    {
        db.AddRange(todos);
        db.UserTodoViewPreferences.AddRange(preferences);
        await db.SaveChangesAsync();
        db.ChangeTracker.Clear();
    }

    private static Task<(IReadOnlyList<TodoItem> Items, int TotalCount)> PageAsync(
        TodoDbContext db, TodoItem[] todos, Guid? viewerId, int pageNumber = 1, int pageSize = 50)
    {
        var ids = todos.Select(t => t.Id).ToArray();
        return new TodoRepository(db, new FixedTimeProvider()).GetPagedWithIncludesAsync(
            t => ids.Contains(t.Id), pageNumber, pageSize, sortCompletedByCompletionTime: false, viewerId);
    }

    private sealed class FixedTimeProvider : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => new(UtcNow);
    }
}

public sealed class TodoActiveListPostgresFixture : IAsyncLifetime
{
    // A non-UTC server timezone catches accidental local-day truncation in translated SQL.
    private readonly PostgreSqlContainer _container = new PostgreSqlBuilder("postgres:16-alpine")
        .WithCommand("-c", "timezone=Pacific/Honolulu")
        .Build();

    public TodoDbContext CreateContext() => new(new DbContextOptionsBuilder<TodoDbContext>()
        .UseNpgsql(_container.GetConnectionString(), options => options.EnableRetryOnFailure())
        .Options);

    public async Task InitializeAsync()
    {
        await _container.StartAsync();
        await using var db = CreateContext();
        await db.Database.EnsureCreatedAsync();
    }

    public Task DisposeAsync() => _container.DisposeAsync().AsTask();
}
