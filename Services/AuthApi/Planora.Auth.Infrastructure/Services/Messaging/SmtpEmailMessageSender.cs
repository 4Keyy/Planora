using System.Net;
using System.Net.Mail;
using System.Net.Mime;
using System.Text;

namespace Planora.Auth.Infrastructure.Services.Messaging;

public sealed class SmtpEmailMessageSender : IEmailMessageSender
{
    public async Task SendAsync(
        EmailMessage message,
        EmailOptions options,
        CancellationToken cancellationToken)
    {
        using var mailMessage = new MailMessage
        {
            From = new MailAddress(options.EffectiveFromEmail, options.FromName),
            Subject = message.Subject,
            SubjectEncoding = Encoding.UTF8,
            Body = message.HtmlBody,
            BodyEncoding = Encoding.UTF8,
            IsBodyHtml = true
        };

        mailMessage.To.Add(new MailAddress(message.ToEmail, message.ToName));
        mailMessage.AlternateViews.Add(
            AlternateView.CreateAlternateViewFromString(
                message.TextBody,
                Encoding.UTF8,
                MediaTypeNames.Text.Plain));
        mailMessage.AlternateViews.Add(
            AlternateView.CreateAlternateViewFromString(
                message.HtmlBody,
                Encoding.UTF8,
                MediaTypeNames.Text.Html));

        using var smtpClient = new SmtpClient(options.SmtpHost, options.SmtpPort)
        {
            EnableSsl = options.EnableSsl,
            Credentials = new NetworkCredential(options.Username, options.Password),
            Timeout = Math.Max(1, options.TimeoutSeconds) * 1000
        };

        await smtpClient.SendMailAsync(mailMessage, cancellationToken);
    }
}
