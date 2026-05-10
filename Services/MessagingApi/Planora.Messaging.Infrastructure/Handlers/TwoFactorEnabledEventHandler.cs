using Planora.Auth.Application.Common.Interfaces;
using Planora.Auth.Domain.Events;

namespace Planora.Messaging.Infrastructure.Handlers
{
    public sealed class TwoFactorEnabledEventHandler : IDomainEventHandler<TwoFactorEnabledEvent>
    {
        private readonly IEventBus _eventBus;
        private readonly IEmailService _emailService;
        private readonly IAuditService _auditService;
        private readonly ILogger<TwoFactorEnabledEventHandler> _logger;

        public TwoFactorEnabledEventHandler(
            IEventBus eventBus,
            IEmailService emailService,
            IAuditService auditService,
            ILogger<TwoFactorEnabledEventHandler> logger)
        {
            _eventBus = eventBus;
            _emailService = emailService;
            _auditService = auditService;
            _logger = logger;
        }

        public async Task HandleAsync(TwoFactorEnabledEvent domainEvent, CancellationToken cancellationToken = default)
        {
            _logger.LogInformation(
                "Handling TwoFactorEnabledEvent for UserId: {UserId}",
                domainEvent.UserId);

            await _auditService.LogAuditEventAsync(
                domainEvent.UserId,
                "TWO_FACTOR_ENABLED",
                "Two-factor authentication enabled",
                cancellationToken: cancellationToken);
        }
    }
}
