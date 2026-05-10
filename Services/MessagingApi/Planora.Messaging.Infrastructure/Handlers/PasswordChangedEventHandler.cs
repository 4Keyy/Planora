using Planora.Auth.Application.Common.Interfaces;
using Planora.Auth.Domain.Events;
using Planora.BuildingBlocks.Infrastructure.Messaging.Events;

namespace Planora.Messaging.Infrastructure.Handlers
{
    public sealed class PasswordChangedEventHandler : IDomainEventHandler<PasswordChangedEvent>
    {
        private readonly IEventBus _eventBus;
        private readonly IEmailService _emailService;
        private readonly IAuditService _auditService;
        private readonly ILogger<PasswordChangedEventHandler> _logger;

        public PasswordChangedEventHandler(
            IEventBus eventBus,
            IEmailService emailService,
            IAuditService auditService,
            ILogger<PasswordChangedEventHandler> logger)
        {
            _eventBus = eventBus;
            _emailService = emailService;
            _auditService = auditService;
            _logger = logger;
        }

        public async Task HandleAsync(PasswordChangedEvent domainEvent, CancellationToken cancellationToken = default)
        {
            _logger.LogInformation(
                "Handling PasswordChangedEvent for UserId: {UserId}",
                domainEvent.UserId);

            var integrationEvent = new PasswordChangedIntegrationEvent(domainEvent.UserId);
            await _eventBus.PublishAsync(integrationEvent, cancellationToken);

            await _auditService.LogAuditEventAsync(
                domainEvent.UserId,
                "PASSWORD_CHANGED",
                "User changed password",
                cancellationToken: cancellationToken);

            await _emailService.SendPasswordChangedNotificationAsync(
                domainEvent.Email,
                "User",
                cancellationToken);
        }
    }
}
