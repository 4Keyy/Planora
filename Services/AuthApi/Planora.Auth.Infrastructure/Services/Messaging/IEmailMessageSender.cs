namespace Planora.Auth.Infrastructure.Services.Messaging;

public interface IEmailMessageSender
{
    Task SendAsync(EmailMessage message, EmailOptions options, CancellationToken cancellationToken);
}
