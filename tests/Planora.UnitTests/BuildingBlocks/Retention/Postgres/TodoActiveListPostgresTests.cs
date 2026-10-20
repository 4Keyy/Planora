using System.Data.Common;
using System.Text.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Npgsql;
using Planora.Todo.Application.Common;
using Planora.Todo.Domain.Entities;
using Planora.Todo.Domain.Enums;
using Planora.Todo.Infrastructure.Persistence;
using Planora.Todo.Infrastructure.Persistence.Repositories;
using Testcontainers.PostgreSql;
using Xunit.Abstractions;
using static Planora.UnitTests.BuildingBlocks.Retention.Postgres.RetentionTestKit;

namespace Planora.UnitTests.BuildingBlocks.Retention.Postgres;

/// <summary>Exercises the active list's correlated ordering and paging on PostgreSQL.</summary>
[Trait("TestType", "Integration")]
public sealed class TodoActiveListPostgresTests(TodoActiveListPostgresFixture fixture, ITestOutputHelper output)
    : IClassFixture<TodoActiveListPostgresFixture>
{
    private static readonly DateTime UtcNow = new(2026, 10, 19, 12, 0, 0, DateTimeKind.Utc);

    [Fact]
    public async Task Fixture_RunsEverySessionOutsideUtc()
    {
        // The point of the fixture: a local-day truncation in translated SQL shows up only when the
        // session's zone is not UTC, on the shared server as in a container.
        await using var db = fixture.CreateContext();

        var zone = await db.Database.SqlQueryRaw<string>("SELECT current_setting('TimeZone') AS \"Value\"").SingleAsync();

        zone.Should().Be("Pacific/Honolulu");
    }

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
        // Audience bands precede the effective hidden state, so even hidden shared tasks precede regular
        // tasks. The four hidden shared tasks are masked: the viewer is sent no creation time for them,
        // so it does not order them either — the id does.
        var masked = new[] { friendViewerHidden, ownSharedHidden, ownPreferenceHidden, friendPublicHidden }
            .OrderBy(t => t.Id).Select(t => t.Id);
        page.Items.Select(t => t.Id).Should().Equal(new[] { friendOwnerHidden.Id, otherViewerIgnored.Id }
            .Concat(masked)
            .Concat(new[] { privatePreferenceIgnored.Id, open.Id, ownPrivateHidden.Id }));
        page.Items.Single(t => t.Id == friendViewerHidden.Id).SharedWith
            .Should().ContainSingle(s => s.SharedWithUserId == viewer);
    }

    [Fact]
    public async Task ActiveList_PrioritizesUrgencyBeforeHiddenState_UsingTheUtcDay()
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

        // Each band's open tasks precede its hidden tasks. Open tasks go by day, then date; a hidden
        // copy carries no date, so hidden tasks go by priority, then newest first.
        page.Items.Select(t => t.Id).Should().Equal(openOverdue.Id, openUrgent.Id,
            hiddenUrgent.Id, hiddenOverdue.Id, hiddenToday.Id, openNew.Id,
            hiddenDone.Id, hiddenNormal.Id, hiddenTomorrow.Id);
        page.Items.Single(t => t.Id == hiddenToday.Id).DueDate!.Value.Kind.Should().Be(DateTimeKind.Utc);
    }

    [Fact]
    public async Task ActiveList_JudgesTheUrgentBandOnTheViewersOwnDay()
    {
        await using var db = fixture.CreateContext();
        var viewer = Guid.NewGuid();
        // 12:00 UTC on Oct 19 is already 02:00 on Oct 20 in Kiritimati (UTC+14).
        var dueOct20 = Create(viewer, "due Oct 20", UtcNow.AddHours(-2), dueDate: UtcNow.Date.AddDays(1));
        var high = Create(viewer, "undated high", UtcNow.AddHours(-1), priority: TodoPriority.High);
        var todos = new[] { dueOct20, high };
        await SeedAsync(db, todos);

        // On the UTC day the task is due tomorrow: a regular task, after the High one.
        (await PageAsync(db, todos, viewer)).Items.Select(t => t.Id).Should().Equal(high.Id, dueOct20.Id);

        // In Kiritimati it is due today: the urgent band, first.
        using (ViewerCalendar.Use(TimeZoneInfo.FindSystemTimeZoneById("Pacific/Kiritimati")))
            (await PageAsync(db, todos, viewer)).Items.Select(t => t.Id).Should().Equal(dueOct20.Id, high.Id);
    }

    [Fact]
    public async Task ActiveList_MatchesTheSharedGoldenOrder_PageByPage()
    {
        // tests/fixtures/active-list-order.json — the client's sortTasks must produce the same order
        // (frontend/src/test/utils/active-list-order.contract.test.ts), so a page of the Dashboard
        // holds the tasks Tasks shows in that place.
        var golden = GoldenOrder.Load();
        await using var db = fixture.CreateContext();
        var viewer = Guid.NewGuid();
        var friend = Guid.NewGuid();
        var zone = TimeZoneInfo.FindSystemTimeZoneById(golden.TimeZone);
        var today = TimeZoneInfo.ConvertTimeFromUtc(golden.Now, zone).Date;
        var todos = new List<TodoItem>();
        var preferences = new List<UserTodoViewPreference>();
        foreach (var task in golden.Tasks)
        {
            var owner = task.Owner == "viewer" ? viewer : friend;
            var other = owner == viewer ? friend : viewer;
            var todo = TodoItem.Create(owner, task.Label,
                priority: Enum.Parse<TodoPriority>(task.Priority),
                dueDate: task.Due is int days ? DateTime.SpecifyKind(today.AddDays(days), DateTimeKind.Utc) : null,
                isPublic: task.Audience == "public",
                sharedWithUserIds: task.Audience == "shared" ? new[] { other } : null);
            if (task.Status == "InProgress")
                todo.MarkAsInProgress(owner);
            if (task.Hidden)
                todo.SetHidden(true, owner);
            if (task.ViewerWorks)
                todo.AddWorker(viewer);
            Set(todo, nameof(TodoItem.CreatedAt), golden.Now.AddHours(-task.CreatedHoursAgo));
            if (task.HiddenByViewer)
                preferences.Add(HiddenPreference(viewer, todo));
            todos.Add(todo);
        }
        await SeedAsync(db, todos.ToArray(), preferences.ToArray());

        using (ViewerCalendar.Use(zone))
        {
            var whole = await PageAsync(db, todos.ToArray(), viewer, now: golden.Now);
            whole.Items.Select(t => t.Title).Should().Equal(golden.Expected);

            var paged = new List<string>();
            for (var pageNumber = 1; paged.Count < golden.Expected.Length; pageNumber++)
                paged.AddRange((await PageAsync(db, todos.ToArray(), viewer, pageNumber, pageSize: 6, now: golden.Now))
                    .Items.Select(t => t.Title));
            paged.Should().Equal(golden.Expected);
        }
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
    public async Task ActiveList_PagesUrgentPrioritySharedAndRegularBands_WithHiddenLastInEachBand()
    {
        await using var db = fixture.CreateContext();
        var viewer = Guid.NewGuid();
        var friend = Guid.NewGuid();
        var now = UtcNow;
        var urgent = Create(viewer, "urgent", now, priority: TodoPriority.Urgent);
        var overdue = Create(viewer, "overdue", now, dueDate: now.AddDays(-1));
        var hiddenUrgent = Create(viewer, "hidden urgent", now, hidden: true, priority: TodoPriority.Urgent);
        var high = Create(viewer, "high", now, priority: TodoPriority.High);
        var highShared = Create(viewer, "high shared", now.AddDays(-1), priority: TodoPriority.High, sharedWith: friend);
        var hiddenHigh = Create(viewer, "hidden high", now, hidden: true, priority: TodoPriority.High);
        var shared = Create(viewer, "shared", now, sharedWith: friend);
        var isPublic = Create(viewer, "public", now.AddDays(-1), isPublic: true);
        var hiddenShared = Create(friend, "hidden shared", now.AddDays(1), sharedWith: viewer);
        var regular = Create(viewer, "regular", now);
        var regularOld = Create(viewer, "old regular", now.AddDays(-1));
        var hiddenRegular = Create(viewer, "hidden regular", now.AddDays(1), hidden: true);
        var expected = new[] { overdue, urgent, hiddenUrgent, high, highShared, hiddenHigh,
            shared, isPublic, hiddenShared, regular, regularOld, hiddenRegular };
        var todos = expected.Reverse().ToArray();
        await SeedAsync(db, todos, HiddenPreference(viewer, hiddenShared));

        var first = await PageAsync(db, todos, viewer, pageNumber: 1, pageSize: 6);
        var second = await PageAsync(db, todos, viewer, pageNumber: 2, pageSize: 6);

        first.TotalCount.Should().Be(todos.Length);
        second.TotalCount.Should().Be(todos.Length);
        first.Items.Select(t => t.Id).Should().Equal(expected.Take(6).Select(t => t.Id));
        second.Items.Select(t => t.Id).Should().Equal(expected.Skip(6).Select(t => t.Id));
        first.Items.Concat(second.Items).Select(t => t.Id).Should().OnlyHaveUniqueItems();
        first.Items.Single(t => t.Id == highShared.Id).SharedWith.Should().ContainSingle();
    }

    [Fact]
    public async Task ActiveList_PrioritizesTheViewersWorkWithinEachBand_UsingOwnerStatusOrWorkerMembership()
    {
        await using var db = fixture.CreateContext();
        var viewer = Guid.NewGuid();
        var friend = Guid.NewGuid();
        var urgent = Create(viewer, "urgent above working high", UtcNow.AddDays(-5), priority: TodoPriority.Urgent);
        var workingHigh = Create(viewer, "working high", UtcNow.AddDays(-4), priority: TodoPriority.High);
        workingHigh.MarkAsInProgress(viewer);
        var idleHigh = Create(viewer, "idle high", UtcNow, priority: TodoPriority.High);
        var friendWorker = Create(friend, "viewer works on friend's task", UtcNow.AddDays(-3), sharedWith: viewer);
        friendWorker.AddWorker(viewer);
        var friendInProgress = Create(friend, "only friend works on it", UtcNow, sharedWith: viewer);
        friendInProgress.MarkAsInProgress(friend);
        var otherWorker = Create(friend, "someone else works on it", UtcNow.AddDays(-1), sharedWith: viewer);
        otherWorker.AddWorker(Guid.NewGuid());
        var workingRegular = Create(viewer, "working regular", UtcNow.AddDays(-2), priority: TodoPriority.Low);
        workingRegular.MarkAsInProgress(viewer);
        var idleRegular = Create(viewer, "idle regular", UtcNow);
        var expected = new[] { urgent, workingHigh, idleHigh, friendWorker, friendInProgress,
            otherWorker, workingRegular, idleRegular };
        var todos = expected.Reverse().ToArray();
        await SeedAsync(db, todos);

        var page = await PageAsync(db, todos, viewer);

        page.Items.Select(t => t.Id).Should().Equal(expected.Select(t => t.Id));
        page.Items.Single(t => t.Id == friendWorker.Id).Workers.Should().ContainSingle(w => w.UserId == viewer);
    }

    [Fact]
    public async Task ActiveList_OrdersDatesNullsLast_ThenPriorityAndNewestCreation()
    {
        await using var db = fixture.CreateContext();
        var viewer = Guid.NewGuid();
        var tomorrow = UtcNow.Date.AddDays(1);
        var dated = Create(viewer, "earliest date even with low priority", UtcNow.AddDays(-10),
            priority: TodoPriority.Low, dueDate: tomorrow);
        var mediumNew = Create(viewer, "same date medium new", UtcNow, dueDate: tomorrow.AddDays(1));
        var mediumOld = Create(viewer, "same date medium old", UtcNow.AddDays(-1), dueDate: tomorrow.AddDays(1));
        var low = Create(viewer, "same date low", UtcNow.AddDays(1),
            priority: TodoPriority.Low, dueDate: tomorrow.AddDays(1));
        var undated = Create(viewer, "undated medium", UtcNow.AddDays(2));
        var undatedLow = Create(viewer, "undated low", UtcNow.AddDays(3), priority: TodoPriority.Low);
        var expected = new[] { dated, mediumNew, mediumOld, low, undated, undatedLow };
        var todos = expected.Reverse().ToArray();
        await SeedAsync(db, todos);

        var page = await PageAsync(db, todos, viewer);

        page.Items.Select(t => t.Id).Should().Equal(expected.Select(t => t.Id));
    }

    [Fact]
    public async Task ActiveList_ExecutesTheWholeOrderingBeforePaging_InOneRootSelectWithSplitIncludes()
    {
        var capture = new QueryCapture();
        await using var db = fixture.CreateContext(capture);
        var viewer = Guid.NewGuid();
        var high = Create(viewer, "high", UtcNow, priority: TodoPriority.High);
        var hiddenUrgent = Create(viewer, "hidden urgent", UtcNow.AddDays(-1), hidden: true, priority: TodoPriority.Urgent);
        var todos = new[] { high, hiddenUrgent };
        await SeedAsync(db, todos);
        capture.Commands.Clear();

        var page = await PageAsync(db, todos, viewer, pageNumber: 2, pageSize: 1);

        page.Items.Should().ContainSingle(t => t.Id == high.Id);
        // Count + one paged root SELECT + three existing split includes (tags, shares, workers).
        capture.Commands.Should().HaveCount(5);
        var rootSql = capture.Commands[1];
        output.WriteLine(rootSql);
        rootSql.Should().StartWith("SELECT t.")
            .And.Contain("LEFT JOIN (")
            .And.Contain("user_todo_view_preferences")
            .And.Contain("ORDER BY CASE")
            .And.Contain("todo_item_shares")
            .And.Contain("todo_item_workers")
            .And.Contain("t.\"DueDate\"")
            .And.Contain("t.\"Priority\"")
            .And.Contain("t.\"CreatedAt\"")
            // The date and the creation time a hidden or masked row withholds do not order it.
            .And.Contain("THEN NULL")
            .And.Contain("END DESC, t.\"Id\"")
            .And.Contain("LIMIT ")
            .And.Contain("OFFSET ")
            .And.NotContain("FROM (");
        rootSql.IndexOf("ORDER BY", StringComparison.Ordinal).Should()
            .BeLessThan(rootSql.IndexOf("LIMIT ", StringComparison.Ordinal));
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
        TodoDbContext db, TodoItem[] todos, Guid? viewerId, int pageNumber = 1, int pageSize = 50, DateTime? now = null)
    {
        var ids = todos.Select(t => t.Id).ToArray();
        return new TodoRepository(db, new FixedTimeProvider(now ?? UtcNow)).GetPagedWithIncludesAsync(
            t => ids.Contains(t.Id), pageNumber, pageSize, sortCompletedByCompletionTime: false, viewerId);
    }

    private sealed class FixedTimeProvider(DateTime utcNow) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => new(utcNow);
    }

    private sealed record GoldenTask(
        string Label, string Owner, string Priority, string? Status, int? Due, double CreatedHoursAgo,
        string? Audience, bool Hidden, bool HiddenByViewer, bool ViewerWorks);

    private sealed record GoldenOrder(DateTime Now, string TimeZone, GoldenTask[] Tasks, string[] Expected)
    {
        public static GoldenOrder Load()
        {
            var directory = new DirectoryInfo(AppContext.BaseDirectory);
            while (directory is not null && !File.Exists(Path.Combine(directory.FullName, "Planora.sln")))
                directory = directory.Parent;
            var path = Path.Combine(directory?.FullName ?? throw new DirectoryNotFoundException("Planora.sln was not found."),
                "tests", "fixtures", "active-list-order.json");
            return JsonSerializer.Deserialize<GoldenOrder>(File.ReadAllText(path),
                new JsonSerializerOptions(JsonSerializerDefaults.Web))!;
        }
    }

    private sealed class QueryCapture : DbCommandInterceptor
    {
        public List<string> Commands { get; } = [];

        public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(
            DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result,
            CancellationToken cancellationToken = default)
        {
            Commands.Add(command.CommandText);
            return ValueTask.FromResult(result);
        }
    }
}

public sealed class TodoActiveListPostgresFixture : IAsyncLifetime
{
    // A non-UTC timezone catches accidental local-day truncation in translated SQL.
    private const string SessionTimeZone = "Pacific/Honolulu";

    private PostgreSqlContainer? _container;
    private TemporaryDatabase? _database;
    private string _connectionString = string.Empty;

    public TodoDbContext CreateContext(DbCommandInterceptor? interceptor = null)
    {
        var options = new DbContextOptionsBuilder<TodoDbContext>()
            .UseNpgsql(_connectionString, npgsql => npgsql.EnableRetryOnFailure());
        if (interceptor is not null)
            options.AddInterceptors(interceptor);
        return new TodoDbContext(options.Options);
    }

    public async Task InitializeAsync()
    {
        // The server PLANORA_TEST_POSTGRES names when it is set — CI's service, or a local one —
        // in a database of its own; otherwise a throwaway container.
        if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable(PostgresFactAttribute.Variable)))
        {
            _container = new PostgreSqlBuilder("postgres:16-alpine")
                .WithCommand("-c", $"timezone={SessionTimeZone}")
                .Build();
            await _container.StartAsync();
            _connectionString = _container.GetConnectionString();
        }
        else
        {
            _database = await TemporaryDatabase.CreateAsync();
            await using (var connection = new NpgsqlConnection(_database.ConnectionString))
            {
                await connection.OpenAsync();
                await using var command = new NpgsqlCommand(
                    $"ALTER DATABASE \"{_database.Name}\" SET timezone TO '{SessionTimeZone}'", connection);
                await command.ExecuteNonQueryAsync();
            }
            _connectionString = _database.ConnectionString;
        }

        await using var db = CreateContext();
        await db.Database.EnsureCreatedAsync();
    }

    public async Task DisposeAsync()
    {
        if (_container is not null)
            await _container.DisposeAsync();
        if (_database is not null)
            await _database.DisposeAsync();
    }
}
