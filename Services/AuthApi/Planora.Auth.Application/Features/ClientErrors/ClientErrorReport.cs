namespace Planora.Auth.Application.Features.ClientErrors;

/// <summary>
/// A failure the web client saw — an uncaught error, an unhandled rejection, or a crash an error
/// boundary caught — reported so it reaches the service logs. The client strips tokens before
/// sending (<c>describeError</c>) and sends no credentials; everything here is untrusted text.
/// </summary>
public sealed record ClientErrorReport
{
    /// <summary><c>error</c>, <c>unhandledrejection</c>, <c>boundary</c> or <c>segment</c>.</summary>
    public string Kind { get; init; } = string.Empty;

    /// <summary>The error's name, e.g. <c>TypeError</c>.</summary>
    public string? Name { get; init; }

    public string Message { get; init; } = string.Empty;

    public string? Stack { get; init; }

    /// <summary>The digest Next.js shows on its error screens, linking the report to a server log.</summary>
    public string? Digest { get; init; }

    /// <summary>The page's path, without its query or fragment.</summary>
    public string Route { get; init; } = string.Empty;

    public DateTimeOffset? OccurredAt { get; init; }
}
