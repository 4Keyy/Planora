namespace Planora.Todo.Application.Common;

/// <summary>
/// The calendar of the person a request is for. A task's due date is a calendar day stored as its
/// midnight UTC, so "due today" and "overdue" depend on whose today it is. The web client sends
/// its IANA time zone in <see cref="TimeZoneHeader"/>, and the TodoApi middleware makes it the
/// ambient zone for that request. Without the header, or with an id this host cannot resolve,
/// the viewer's day is the UTC day — the rule before the header existed.
/// </summary>
public static class ViewerCalendar
{
    /// <summary>The request header that carries the viewer's IANA time zone id.</summary>
    public const string TimeZoneHeader = "X-Time-Zone";

    private const int MaxTimeZoneIdLength = 64;
    private static readonly AsyncLocal<TimeZoneInfo?> Current = new();

    /// <summary>The ambient viewer's time zone; UTC when none was set for this request.</summary>
    public static TimeZoneInfo Zone => Current.Value ?? TimeZoneInfo.Utc;

    /// <summary>The viewer's calendar day at <paramref name="utcNow"/>.</summary>
    public static DateTime Today(DateTime utcNow)
    {
        var utc = utcNow.Kind == DateTimeKind.Utc ? utcNow : DateTime.SpecifyKind(utcNow, DateTimeKind.Utc);
        return TimeZoneInfo.ConvertTimeFromUtc(utc, Zone).Date;
    }

    /// <summary>
    /// The stored form of the day after the viewer's today: its midnight UTC. A due date earlier
    /// than this is due today or overdue for the viewer.
    /// </summary>
    public static DateTime NextDayAsStoredDueDate(DateTime utcNow) =>
        DateTime.SpecifyKind(Today(utcNow).AddDays(1), DateTimeKind.Utc);

    /// <summary>Makes <paramref name="zone"/> the viewer's zone until the returned scope is disposed.</summary>
    public static IDisposable Use(TimeZoneInfo zone)
    {
        ArgumentNullException.ThrowIfNull(zone);
        var previous = Current.Value;
        Current.Value = zone;
        return new Scope(previous);
    }

    /// <summary>
    /// Resolves a time zone id sent by a client. Only short ids made of the characters IANA and
    /// Windows ids use are looked up; anything missing, malformed or unknown is rejected.
    /// </summary>
    public static bool TryResolve(string? id, out TimeZoneInfo zone)
    {
        zone = TimeZoneInfo.Utc;
        if (string.IsNullOrWhiteSpace(id) || id.Length > MaxTimeZoneIdLength)
            return false;

        foreach (var c in id)
        {
            if (!(char.IsAsciiLetterOrDigit(c) || c is '/' or '_' or '-' or '+' or ' '))
                return false;
        }

        if (!TimeZoneInfo.TryFindSystemTimeZoneById(id, out var found))
            return false;

        zone = found;
        return true;
    }

    private sealed class Scope(TimeZoneInfo? previous) : IDisposable
    {
        public void Dispose() => Current.Value = previous;
    }
}
