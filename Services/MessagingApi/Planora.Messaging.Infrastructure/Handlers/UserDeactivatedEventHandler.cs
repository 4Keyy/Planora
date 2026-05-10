using Planora.Auth.Application.Common.Interfaces;
using Planora.Auth.Domain.Events;
using Planora.BuildingBlocks.Infrastructure.Messaging.Events;

namespace Planora.Messaging.Infrastructure.Handlers
{
    public sealed class UserDeactivatedEventHandler : IDomainEventHandler<UserDeactivatedEvent>
    {
        private readonly IEventBus _eventBus;
        private readonly IAuditService _auditService;
        private readonly ILogger<UserDeactivatedEventHandler> _logger;

        public UserDeactivatedEventHandler(
            IEventBus eventBus,
            IAuditService auditService,
            ILogger<UserDeactivatedEventHandler> logger)
        {
            _eventBus = eventBus;
            _auditService = auditService;
            _logger = logger;
        }

        public async Task HandleAsync(UserDeactivatedEvent domainEvent, CancellationToken cancellationToken = default)
        {
            _logger.LogInformation(
                "User deactivated: UserId={UserId}, Email={Email}",
                domainEvent.UserId,
                domainEvent.Email);

            var integrationEvent = new UserDeletedIntegrationEvent(
                domainEvent.UserId,
                domainEvent.Email);

            await _eventBus.PublishAsync(integrationEvent, cancellationToken);

            await _auditService.LogAuditEventAsync(
                domainEvent.UserId,
                "USER_DEACTIVATED",
                $"User {domainEvent.Email} deactivated",
                cancellationToken: cancellationToken);
        }
    }
}
