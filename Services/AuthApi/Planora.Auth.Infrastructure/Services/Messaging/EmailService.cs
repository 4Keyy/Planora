using System.Net;
using Microsoft.Extensions.Options;

namespace Planora.Auth.Infrastructure.Services.Messaging;

public sealed class EmailService : IEmailService
{
    private readonly ILogger<EmailService> _logger;
    private readonly EmailOptions _options;
    private readonly IEmailMessageSender _sender;

    public EmailService(ILogger<EmailService> logger)
        : this(logger, Options.Create(new EmailOptions()), new SmtpEmailMessageSender())
    {
    }

    public EmailService(
        ILogger<EmailService> logger,
        IOptions<EmailOptions> options,
        IEmailMessageSender sender)
    {
        _logger = logger;
        _options = options.Value;
        _sender = sender;
    }

    public Task SendEmailVerificationAsync(
        string email,
        string firstName,
        string verificationLink,
        CancellationToken cancellationToken = default)
    {
        return SendAsync(
            email,
            firstName,
            "Verify your Planora email",
            "Verify your email",
            "Use the button below to verify your Planora account email address.",
            "Verify email",
            verificationLink,
            cancellationToken);
    }

    public Task SendPasswordChangedNotificationAsync(
        string email,
        string firstName,
        CancellationToken cancellationToken = default)
    {
        return SendAsync(
            email,
            firstName,
            "Your Planora password was changed",
            "Password changed",
            "Your Planora account password was changed. If this was not you, reset your password immediately.",
            actionText: null,
            actionUrl: null,
            cancellationToken);
    }

    public Task SendEmailChangedNotificationAsync(
        string oldEmail,
        string newEmail,
        string firstName,
        CancellationToken cancellationToken = default)
    {
        return SendAsync(
            oldEmail,
            firstName,
            "Your Planora email was changed",
            "Email changed",
            $"Your Planora account email was changed to {newEmail}.",
            actionText: null,
            actionUrl: null,
            cancellationToken);
    }

    public Task SendPasswordResetEmailAsync(
        string email,
        string firstName,
        string resetLink,
        CancellationToken cancellationToken = default)
    {
        return SendAsync(
            email,
            firstName,
            "Reset your Planora password",
            "Reset your password",
            "Use the button below to reset your Planora account password.",
            "Reset password",
            resetLink,
            cancellationToken);
    }

    public Task SendAccountLockedNotificationAsync(
        string email,
        string firstName,
        DateTime lockedUntil,
        CancellationToken cancellationToken = default)
    {
        return SendAsync(
            email,
            firstName,
            "Your Planora account was locked",
            "Account locked",
            $"Your Planora account was locked until {lockedUntil:u}.",
            actionText: null,
            actionUrl: null,
            cancellationToken);
    }

    public Task SendTwoFactorEnabledNotificationAsync(
        string email,
        string firstName,
        CancellationToken cancellationToken = default)
    {
        return SendAsync(
            email,
            firstName,
            "Two-factor authentication enabled",
            "2FA enabled",
            "Two-factor authentication was enabled for your Planora account.",
            actionText: null,
            actionUrl: null,
            cancellationToken);
    }

    private async Task SendAsync(
        string email,
        string firstName,
        string subject,
        string heading,
        string body,
        string? actionText,
        string? actionUrl,
        CancellationToken cancellationToken)
    {
        if (!_options.IsSmtpEnabled)
        {
            ValidateProvider();
            LogDevelopmentEmail(email, subject, actionUrl);
            return;
        }

        ValidateSmtpOptions();

        var message = BuildMessage(
            email,
            firstName,
            subject,
            heading,
            body,
            actionText,
            actionUrl);

        await _sender.SendAsync(message, _options, cancellationToken);

        _logger.LogInformation(
            "Email sent through {Provider}: Subject={Subject}, To={Email}",
            _options.Provider,
            subject,
            email);
    }

    private EmailMessage BuildMessage(
        string email,
        string firstName,
        string subject,
        string heading,
        string body,
        string? actionText,
        string? actionUrl)
    {
        var safeFirstName = WebUtility.HtmlEncode(
            string.IsNullOrWhiteSpace(firstName) ? "there" : firstName.Trim());
        var safeHeading = WebUtility.HtmlEncode(heading);
        var safeBody = WebUtility.HtmlEncode(body);
        var safeActionText = WebUtility.HtmlEncode(actionText ?? string.Empty);
        var safeActionUrl = WebUtility.HtmlEncode(actionUrl ?? string.Empty);

        var actionHtml = string.IsNullOrWhiteSpace(actionText) || string.IsNullOrWhiteSpace(actionUrl)
            ? string.Empty
            : $"""
              <p style="margin:24px 0;">
                <a href="{safeActionUrl}" style="background:#111827;color:#ffffff;display:inline-block;font-weight:700;padding:12px 18px;text-decoration:none;border-radius:8px;">
                  {safeActionText}
                </a>
              </p>
              <p style="color:#6b7280;font-size:13px;line-height:20px;margin:0;">If the button does not work, open this link:<br><a href="{safeActionUrl}" style="color:#111827;">{safeActionUrl}</a></p>
              """;

        var html = $"""
            <!doctype html>
            <html lang="en">
            <body style="font-family:Arial,sans-serif;background:#f3f4f6;margin:0;padding:24px;">
              <main style="background:#ffffff;border-radius:12px;margin:0 auto;max-width:560px;padding:28px;">
                <p style="color:#111827;font-size:16px;line-height:24px;margin:0 0 16px;">Hi {safeFirstName},</p>
                <h1 style="color:#111827;font-size:24px;line-height:32px;margin:0 0 12px;">{safeHeading}</h1>
                <p style="color:#374151;font-size:15px;line-height:24px;margin:0;">{safeBody}</p>
                {actionHtml}
                <p style="color:#9ca3af;font-size:12px;line-height:18px;margin:28px 0 0;">Planora security notification</p>
              </main>
            </body>
            </html>
            """;

        var text = string.IsNullOrWhiteSpace(actionUrl)
            ? $"{heading}\n\nHi {firstName},\n\n{body}\n\nPlanora security notification"
            : $"{heading}\n\nHi {firstName},\n\n{body}\n\n{actionText}: {actionUrl}\n\nPlanora security notification";

        return new EmailMessage(email, firstName, subject, html, text);
    }

    private void ValidateSmtpOptions()
    {
        ValidateProvider();

        if (string.IsNullOrWhiteSpace(_options.SmtpHost))
        {
            throw new InvalidOperationException("Email:SmtpHost is required when Email:Provider enables SMTP.");
        }

        if (_options.SmtpPort <= 0)
        {
            throw new InvalidOperationException("Email:SmtpPort must be greater than zero.");
        }

        if (string.IsNullOrWhiteSpace(_options.Username))
        {
            throw new InvalidOperationException("Email:Username is required when Email:Provider enables SMTP.");
        }

        if (string.IsNullOrWhiteSpace(_options.Password))
        {
            throw new InvalidOperationException("Email:Password is required when Email:Provider enables SMTP.");
        }

        if (string.IsNullOrWhiteSpace(_options.EffectiveFromEmail))
        {
            throw new InvalidOperationException("Email:FromEmail or Email:Username is required when Email:Provider enables SMTP.");
        }
    }

    private void ValidateProvider()
    {
        if (_options.IsLogProvider || _options.IsSmtpEnabled)
        {
            return;
        }

        throw new InvalidOperationException(
            $"Email:Provider must be {EmailOptions.LogProvider}, {EmailOptions.GmailSmtpProvider}, or {EmailOptions.SmtpProvider}.");
    }

    private void LogDevelopmentEmail(string email, string subject, string? actionUrl)
    {
        if (string.IsNullOrWhiteSpace(actionUrl))
        {
            _logger.LogInformation(
                "[EMAIL:LOG] Subject={Subject}, To={Email}",
                subject,
                email);
            return;
        }

        _logger.LogInformation(
            "[EMAIL:LOG] Subject={Subject}, To={Email}, Link={Link}",
            subject,
            email,
            actionUrl);
    }
}
