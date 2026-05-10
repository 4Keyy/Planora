using Planora.Auth.Application.Common.Interfaces;
using Planora.Auth.Domain.Events;

namespace Planora.Messaging.Infrastructure.Handlers
{
    public sealed class EmailChangedEventHandler : IDomainEventHandler<EmailChangedEvent>
    {
        private readonly IEmailService _emailService;
        private readonly IAuditService _auditService;
        private readonly ILogger<EmailChangedEventHandler> _logger;

        public EmailChangedEventHandler(
            IEmailService emailService,
            IAuditService auditService,
            ILogger<EmailChangedEventHandler> logger)
        {
            _emailService = emailService;
            _auditService = auditService;
            _logger = logger;
        }

        public async Task HandleAsync(EmailChangedEvent domainEvent, CancellationToken cancellationToken = default)
        {
            _logger.LogInformation(
                "Handling EmailChangedEvent for UserId: {UserId}, OldEmail: {OldEmail}, NewEmail: {NewEmail}",
                domainEvent.UserId,
                domainEvent.OldEmail,
                domainEvent.NewEmail);

            await _auditService.LogAuditEventAsync(
                domainEvent.UserId,
                "EMAIL_CHANGED",
                $"Email changed from {domainEvent.OldEmail} to {domainEvent.NewEmail}",
                cancellationToken: cancellationToken);

            await _emailService.SendEmailChangedNotificationAsync(
                domainEvent.OldEmail,
                domainEvent.NewEmail,
                "User",
                cancellationToken);
        }
    }
}
