using Planora.Auth.Application.Common.Interfaces;
using Planora.Auth.Domain.Events;
using Planora.BuildingBlocks.Infrastructure.Messaging.Events;

namespace Planora.Messaging.Infrastructure.Handlers
{
    public sealed class UserLockedEventHandler : IDomainEventHandler<UserLockedEvent>
    {
        private readonly IEventBus _eventBus;
        private readonly IEmailService _emailService;
        private readonly IAuditService _auditService;
        private readonly ILogger<UserLockedEventHandler> _logger;

        public UserLockedEventHandler(
            IEventBus eventBus,
            IEmailService emailService,
            IAuditService auditService,
            ILogger<UserLockedEventHandler> logger)
        {
            _eventBus = eventBus;
            _emailService = emailService;
            _auditService = auditService;
            _logger = logger;
        }

        public async Task HandleAsync(UserLockedEvent domainEvent, CancellationToken cancellationToken = default)
        {
            _logger.LogWarning(
                "User account locked: UserId={UserId}, Until={LockedUntil}",
                domainEvent.UserId,
                domainEvent.LockedUntil);

            var integrationEvent = new AccountLockedIntegrationEvent(
                domainEvent.UserId,
                domainEvent.Email,
                domainEvent.LockedUntil,
                "Too many failed login attempts");

            await _eventBus.PublishAsync(integrationEvent, cancellationToken);

            await _auditService.LogAuditEventAsync(
                domainEvent.UserId,
                "ACCOUNT_LOCKED",
                $"Account locked until {domainEvent.LockedUntil}",
                cancellationToken: cancellationToken);

            await _emailService.SendAccountLockedNotificationAsync(
                domainEvent.Email,
                "User",
                domainEvent.LockedUntil,
                cancellationToken);
        }
    }
}
