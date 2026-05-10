namespace Planora.Auth.Infrastructure.Services.Messaging;

public sealed record EmailMessage(
    string ToEmail,
    string ToName,
    string Subject,
    string HtmlBody,
    string TextBody);
