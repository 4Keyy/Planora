using Planora.Auth.Application.Common.Interfaces;
using Planora.Auth.Domain.Events;
using Planora.BuildingBlocks.Infrastructure.Messaging.Events;

namespace Planora.Messaging.Infrastructure.Handlers
{
    public sealed class EmailVerifiedEventHandler : IDomainEventHandler<EmailVerifiedEvent>
    {
        private readonly IEventBus _eventBus;
        private readonly IAuditService _auditService;
        private readonly ILogger<EmailVerifiedEventHandler> _logger;

        public EmailVerifiedEventHandler(
            IEventBus eventBus,
            IAuditService auditService,
            ILogger<EmailVerifiedEventHandler> logger)
        {
            _eventBus = eventBus;
            _auditService = auditService;
            _logger = logger;
        }

        public async Task HandleAsync(EmailVerifiedEvent domainEvent, CancellationToken cancellationToken = default)
        {
            _logger.LogInformation(
                "Handling EmailVerifiedEvent for UserId: {UserId}, Email: {Email}",
                domainEvent.UserId,
                domainEvent.Email);

            var integrationEvent = new EmailVerifiedIntegrationEvent(
                domainEvent.UserId,
                domainEvent.Email);

            await _eventBus.PublishAsync(integrationEvent, cancellationToken);

            await _auditService.LogAuditEventAsync(
                domainEvent.UserId,
                "EMAIL_VERIFIED",
                $"Email {domainEvent.Email} verified successfully",
                cancellationToken: cancellationToken);
        }
    }
}
