namespace Planora.Auth.Infrastructure.Services.Messaging;

public sealed class EmailOptions
{
    public const string SectionName = "Email";
    public const string LogProvider = "Log";
    public const string GmailSmtpProvider = "GmailSmtp";
    public const string SmtpProvider = "Smtp";

    public string Provider { get; set; } = LogProvider;

    public string SmtpHost { get; set; } = "smtp.gmail.com";

    public int SmtpPort { get; set; } = 587;

    public bool EnableSsl { get; set; } = true;

    public string Username { get; set; } = string.Empty;

    public string Password { get; set; } = string.Empty;

    public string FromEmail { get; set; } = string.Empty;

    public string FromName { get; set; } = "Planora";

    public int TimeoutSeconds { get; set; } = 30;

    public bool IsLogProvider =>
        Provider.Equals(LogProvider, StringComparison.OrdinalIgnoreCase);

    public bool IsSmtpEnabled =>
        Provider.Equals(GmailSmtpProvider, StringComparison.OrdinalIgnoreCase)
        || Provider.Equals(SmtpProvider, StringComparison.OrdinalIgnoreCase);

    public string EffectiveFromEmail =>
        string.IsNullOrWhiteSpace(FromEmail) ? Username : FromEmail;
}
