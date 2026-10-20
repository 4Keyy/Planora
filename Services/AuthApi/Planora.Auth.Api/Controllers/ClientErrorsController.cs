using System.Text.RegularExpressions;
using FluentValidation;
using Microsoft.AspNetCore.RateLimiting;
using Planora.Auth.Application.Features.ClientErrors;

namespace Planora.Auth.Api.Controllers;

/// <summary>
/// Where the web client reports a failure it saw (FE-16): an uncaught error, an unhandled
/// rejection, a crash an error boundary caught. Before this, nobody but the person in front of
/// the screen learned of them. Anyone may report — errors happen before sign-in too — so the
/// request carries no credentials, passes CSRF like every other write, is rate-limited per caller
/// (<c>client-errors</c>), and its bounded, single-line text goes to the log as a warning.
/// </summary>
[ApiController]
[Route("api/v1/client-errors")]
[AllowAnonymous]
[EnableRateLimiting("client-errors")]
[Produces("application/json")]
public sealed partial class ClientErrorsController : ControllerBase
{
    private readonly IValidator<ClientErrorReport> _validator;
    private readonly ILogger<ClientErrorsController> _logger;

    public ClientErrorsController(IValidator<ClientErrorReport> validator, ILogger<ClientErrorsController> logger)
    {
        _validator = validator;
        _logger = logger;
    }

    [HttpPost]
    [ProducesResponseType(StatusCodes.Status202Accepted)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status429TooManyRequests)]
    public async Task<IActionResult> Report([FromBody] ClientErrorReport report, CancellationToken cancellationToken)
    {
        var validation = await _validator.ValidateAsync(report, cancellationToken);
        if (!validation.IsValid)
        {
            return BadRequest(new { error = "INVALID_CLIENT_ERROR_REPORT" });
        }

        using (_logger.BeginScope(new Dictionary<string, object?>
        {
            ["ClientErrorDigest"] = report.Digest,
            ["ClientOccurredAt"] = report.OccurredAt?.UtcDateTime,
            ["ClientStack"] = report.Stack is null ? null : ControlCharacters().Replace(LineBreaks().Replace(report.Stack, " | "), " "),
        }))
        {
            _logger.LogWarning(
                "Client {ClientErrorKind} {ClientErrorName} on {ClientRoute}: {ClientErrorMessage}",
                report.Kind,
                OneLine(report.Name),
                OneLine(report.Route),
                OneLine(report.Message));
        }

        return Accepted();
    }

    /// <summary>One log line per report: a line break in reported text cannot forge another entry.</summary>
    private static string? OneLine(string? text) =>
        text is null ? null : ControlCharacters().Replace(text, " ");

    [GeneratedRegex(@"\r\n|\r|\n")]
    private static partial Regex LineBreaks();

    [GeneratedRegex(@"\p{Cc}")]
    private static partial Regex ControlCharacters();
}
