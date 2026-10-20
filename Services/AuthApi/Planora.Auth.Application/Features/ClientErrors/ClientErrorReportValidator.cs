namespace Planora.Auth.Application.Features.ClientErrors;

/// <summary>
/// Bounds what an anonymous caller can put into the logs: a known kind, short text fields, a
/// path-only route and a plain digest.
/// </summary>
public sealed class ClientErrorReportValidator : AbstractValidator<ClientErrorReport>
{
    public const int MaxMessageLength = 1000;
    public const int MaxStackLength = 8000;

    private static readonly string[] Kinds = ["error", "unhandledrejection", "boundary", "segment"];

    public ClientErrorReportValidator()
    {
        RuleFor(x => x.Kind)
            .Must(kind => Kinds.Contains(kind))
            .WithMessage("Kind must be error, unhandledrejection, boundary or segment.");

        RuleFor(x => x.Name).MaximumLength(120);

        RuleFor(x => x.Message)
            .NotEmpty()
            .MaximumLength(MaxMessageLength);

        RuleFor(x => x.Stack).MaximumLength(MaxStackLength);

        RuleFor(x => x.Digest)
            .MaximumLength(120)
            .Matches("^[A-Za-z0-9_-]+$")
            .When(x => !string.IsNullOrEmpty(x.Digest));

        RuleFor(x => x.Route)
            .NotEmpty()
            .MaximumLength(300)
            .Must(route => route.StartsWith('/') && !route.Contains('?') && !route.Contains('#'))
            .WithMessage("Route must be a path without a query or fragment.");
    }
}
