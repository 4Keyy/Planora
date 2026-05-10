namespace Planora.Auth.Application.Common.Interfaces
{
    public interface IEmailService
    {
        Task SendEmailVerificationAsync(string email, string firstName, string verificationLink, CancellationToken cancellationToken = default);

        Task SendPasswordChangedNotificationAsync(string email, string firstName, CancellationToken cancellationToken = default);

        Task SendEmailChangedNotificationAsync(string oldEmail, string newEmail, string firstName, CancellationToken cancellationToken = default);

        Task SendPasswordResetEmailAsync(string email, string firstName, string resetLink, CancellationToken cancellationToken = default);

        Task SendAccountLockedNotificationAsync(string email, string firstName, DateTime lockedUntil, CancellationToken cancellationToken = default);

        Task SendTwoFactorEnabledNotificationAsync(string email, string firstName, CancellationToken cancellationToken = default);
    }
}
