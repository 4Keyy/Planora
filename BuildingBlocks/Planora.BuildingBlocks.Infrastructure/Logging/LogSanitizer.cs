using System.Text;

namespace Planora.BuildingBlocks.Infrastructure.Logging;

/// <summary>
/// Neutralizes user-controlled values before they are written to a log.
///
/// SECURITY (CodeQL cs/log-forging): attacker-controlled strings — request paths, query
/// values, headers (User-Agent), client IPs, email addresses, etc. — can contain CR/LF or
/// other control characters. Written verbatim into a text log sink, they let an attacker
/// inject forged log lines (e.g. a fake "authentication succeeded" entry) or smuggle
/// terminal escape sequences. Routing every untrusted value through <see cref="Clean"/>
/// strips those control characters so the logged value can only ever be a single,
/// well-behaved line.
/// </summary>
public static class LogSanitizer
{
    // Bound the logged length so an oversized header/path cannot bloat the log or be used
    // to push earlier context out of a fixed-size viewer.
    private const int MaxLength = 2048;

    /// <summary>
    /// Returns <paramref name="value"/> with CR, LF, tab and every other control character
    /// replaced by a single space, trimmed and length-capped. Safe to call on null.
    /// </summary>
    public static string Clean(string? value)
    {
        if (string.IsNullOrEmpty(value))
        {
            return string.Empty;
        }

        var source = value.Length > MaxLength ? value.AsSpan(0, MaxLength) : value.AsSpan();
        var builder = new StringBuilder(source.Length);
        var lastWasSpace = false;

        foreach (var ch in source)
        {
            if (char.IsControl(ch) || ch == ' ')
            {
                // Collapse runs of whitespace/control chars into one space to keep the line tidy.
                if (!lastWasSpace)
                {
                    builder.Append(' ');
                    lastWasSpace = true;
                }
            }
            else
            {
                builder.Append(ch);
                lastWasSpace = false;
            }
        }

        return builder.ToString().Trim();
    }

    /// <summary>
    /// Convenience overload for any value: formats with the invariant culture, then cleans.
    /// </summary>
    public static string Clean(object? value)
        => Clean(value is IFormattable f
            ? f.ToString(null, System.Globalization.CultureInfo.InvariantCulture)
            : value?.ToString());
}
