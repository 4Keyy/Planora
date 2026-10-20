using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Xunit;

namespace Planora.ErrorHandlingTests.Integration;

/// <summary>
/// "Due today" is the viewer's own calendar day: the Todo API takes the zone from the
/// X-Time-Zone header for the whole request (ViewerCalendar). The tests run on the real clock,
/// so they use two zones 26 hours apart: Kiritimati's today is always at least one day after
/// the today of UTC-12, whenever the suite runs.
/// </summary>
public class ViewerTimeZoneIntegrationTests : IClassFixture<TodoApiTestFactory>
{
    private const string FarEast = "Pacific/Kiritimati"; // UTC+14
    private const string FarWest = "Etc/GMT+12";         // UTC-12 (POSIX sign)

    private readonly HttpClient _client;

    public ViewerTimeZoneIntegrationTests(TodoApiTestFactory factory)
    {
        _client = factory.CreateClient();
    }

    [Fact]
    [Trait("TestType", "Integration")]
    [Trait("TestType", "Regression")]
    public async Task IsVisuallyUrgent_FollowsTheViewersCalendarDay()
    {
        // Due on Kiritimati's today, stored as that day's midnight UTC, as the web editor writes it.
        var kiritimatiToday = TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, TimeZoneInfo.FindSystemTimeZoneById(FarEast)).Date;
        var id = await CreateTodoAsync(DateTime.SpecifyKind(kiritimatiToday, DateTimeKind.Utc));

        (await IsVisuallyUrgentAsync(id, FarEast)).Should().BeTrue("the task is due today in Kiritimati");
        (await IsVisuallyUrgentAsync(id, FarWest)).Should().BeFalse("at UTC-12 the due day has not come yet");
    }

    [Theory]
    [Trait("TestType", "Integration")]
    [Trait("TestType", "Security")]
    [InlineData(null)]
    [InlineData("Mars/Olympus_Mons")]
    [InlineData("../../etc/localtime")]
    public async Task MissingUnknownOrMalformedZone_UsesTheUtcDay(string? header)
    {
        // Due tomorrow on the UTC calendar: never urgent for a UTC viewer.
        var id = await CreateTodoAsync(DateTime.UtcNow.Date.AddDays(1));

        (await IsVisuallyUrgentAsync(id, header)).Should().BeFalse();
    }

    private async Task<Guid> CreateTodoAsync(DateTime dueDate)
    {
        var response = await _client.PostAsJsonAsync("/api/v1/todos", new
        {
            title = "Viewer time zone integration todo",
            dueDate,
        });
        var bodyText = await response.Content.ReadAsStringAsync();
        response.StatusCode.Should().Be(HttpStatusCode.Created, bodyText);

        using var document = JsonDocument.Parse(bodyText);
        return document.RootElement.GetProperty("id").GetGuid();
    }

    private async Task<bool> IsVisuallyUrgentAsync(Guid id, string? timeZone)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, $"/api/v1/todos/{id}");
        if (timeZone is not null)
            request.Headers.TryAddWithoutValidation("X-Time-Zone", timeZone);

        var response = await _client.SendAsync(request);
        var bodyText = await response.Content.ReadAsStringAsync();
        response.StatusCode.Should().Be(HttpStatusCode.OK, bodyText);

        using var document = JsonDocument.Parse(bodyText);
        return document.RootElement.GetProperty("isVisuallyUrgent").GetBoolean();
    }
}
