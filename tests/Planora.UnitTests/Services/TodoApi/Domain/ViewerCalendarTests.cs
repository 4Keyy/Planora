using Planora.Todo.Application.Common;
using Planora.Todo.Domain.Entities;

namespace Planora.UnitTests.Services.TodoApi.Domain;

/// <summary>
/// A due date is a calendar day stored as its midnight UTC; "due today" is judged against the
/// viewer's own day (the X-Time-Zone header), not the UTC day.
/// </summary>
public sealed class ViewerCalendarTests
{
    private static readonly DateTime DueOct21 = new(2026, 10, 21, 0, 0, 0, DateTimeKind.Utc);

    private static TimeZoneInfo Zone(string id) =>
        ViewerCalendar.TryResolve(id, out var zone) ? zone : throw new InvalidOperationException($"{id} is not available on this host.");

    [Fact]
    [Trait("TestType", "Unit")]
    public void Today_IsTheViewersCalendarDay()
    {
        var oneThirtyInMoscow = new DateTime(2026, 10, 20, 22, 30, 0, DateTimeKind.Utc);
        var tenPmInNewYork = new DateTime(2026, 10, 21, 2, 0, 0, DateTimeKind.Utc);

        Assert.Equal(new DateTime(2026, 10, 20), ViewerCalendar.Today(oneThirtyInMoscow));
        using (ViewerCalendar.Use(Zone("Europe/Moscow")))
            Assert.Equal(new DateTime(2026, 10, 21), ViewerCalendar.Today(oneThirtyInMoscow));
        using (ViewerCalendar.Use(Zone("America/New_York")))
            Assert.Equal(new DateTime(2026, 10, 20), ViewerCalendar.Today(tenPmInNewYork));
    }

    [Fact]
    [Trait("TestType", "Unit")]
    public void Use_RestoresThePreviousZoneWhenDisposed()
    {
        Assert.Equal(TimeZoneInfo.Utc, ViewerCalendar.Zone);
        using (ViewerCalendar.Use(Zone("Asia/Tokyo")))
        {
            using (ViewerCalendar.Use(Zone("Europe/Moscow")))
                Assert.Equal(Zone("Europe/Moscow").Id, ViewerCalendar.Zone.Id);
            Assert.Equal(Zone("Asia/Tokyo").Id, ViewerCalendar.Zone.Id);
        }
        Assert.Equal(TimeZoneInfo.Utc, ViewerCalendar.Zone);
    }

    [Theory]
    [Trait("TestType", "Unit")]
    [InlineData("Europe/Moscow")]
    [InlineData("America/New_York")]
    [InlineData("America/Argentina/Buenos_Aires")]
    [InlineData("Etc/GMT+3")]
    [InlineData("UTC")]
    public void TryResolve_AcceptsKnownZones(string id)
    {
        Assert.True(ViewerCalendar.TryResolve(id, out _));
    }

    [Theory]
    [Trait("TestType", "Unit")]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("Mars/Olympus_Mons")]
    [InlineData("../../etc/passwd")]
    [InlineData("Europe/Moscow\r\nX-Injected: 1")]
    [InlineData("America/New_York;DROP")]
    public void TryResolve_RejectsMissingMalformedOrUnknownIds(string? id)
    {
        Assert.False(ViewerCalendar.TryResolve(id, out var zone));
        Assert.Equal(TimeZoneInfo.Utc, zone);
    }

    [Fact]
    [Trait("TestType", "Unit")]
    public void TryResolve_RejectsOverlongIds()
    {
        Assert.False(ViewerCalendar.TryResolve(new string('A', 65), out _));
    }

    [Fact]
    [Trait("TestType", "Unit")]
    [Trait("TestType", "Regression")]
    public void Urgency_FollowsTheViewersToday()
    {
        var todo = TodoItem.Create(Guid.NewGuid(), "File the report", dueDate: DueOct21, priority: Todo.Domain.Enums.TodoPriority.Low);
        var oneThirtyInMoscow = new DateTime(2026, 10, 20, 22, 30, 0, DateTimeKind.Utc);
        var tenPmInNewYork = new DateTime(2026, 10, 21, 2, 0, 0, DateTimeKind.Utc);

        // UTC viewer at 22:30 UTC on Oct 20: the task is due tomorrow.
        Assert.False(IsVisuallyUrgent(todo, oneThirtyInMoscow));
        // In Moscow it is already Oct 21: due today.
        using (ViewerCalendar.Use(Zone("Europe/Moscow")))
            Assert.True(IsVisuallyUrgent(todo, oneThirtyInMoscow));

        // UTC viewer at 02:00 UTC on Oct 21: due today.
        Assert.True(IsVisuallyUrgent(todo, tenPmInNewYork));
        // In New York it is still Oct 20 at 22:00: due tomorrow.
        using (ViewerCalendar.Use(Zone("America/New_York")))
            Assert.False(IsVisuallyUrgent(todo, tenPmInNewYork));
    }

    [Fact]
    [Trait("TestType", "Unit")]
    public void NextDayAsStoredDueDate_IsTheMidnightUtcOfTheViewersTomorrow()
    {
        var oneThirtyInMoscow = new DateTime(2026, 10, 20, 22, 30, 0, DateTimeKind.Utc);
        using (ViewerCalendar.Use(Zone("Europe/Moscow")))
        {
            var bound = ViewerCalendar.NextDayAsStoredDueDate(oneThirtyInMoscow);
            Assert.Equal(new DateTime(2026, 10, 22, 0, 0, 0, DateTimeKind.Utc), bound);
            Assert.Equal(DateTimeKind.Utc, bound.Kind);
            Assert.True(DueOct21 < bound);
        }
    }

    private static bool IsVisuallyUrgent(TodoItem todo, DateTime now)
    {
        var resolver = typeof(Planora.Todo.Application.DependencyInjection)
            .Assembly
            .GetType("Planora.Todo.Application.Features.Todos.TodoViewerStateResolver")
            ?? throw new InvalidOperationException("TodoViewerStateResolver type was not found.");
        var method = resolver.GetMethod("IsVisuallyUrgent")
            ?? throw new InvalidOperationException("IsVisuallyUrgent was not found.");
        return (bool)method.Invoke(null, new object?[] { todo, now })!;
    }
}
