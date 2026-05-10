using Planora.Auth.Application.Common.Interfaces;
using Planora.Auth.Domain.Events;

namespace Planora.Messaging.Infrastructure.Handlers
{
    public sealed class TwoFactorDisabledEventHandler : IDomainEventHandler<TwoFactorDisabledEvent>
    {
        private readonly IAuditService _auditService;
        private readonly ILogger<TwoFactorDisabledEventHandler> _logger;

        public TwoFactorDisabledEventHandler(
            IAuditService auditService,
            ILogger<TwoFactorDisabledEventHandler> logger)
        {
            _auditService = auditService;
            _logger = logger;
        }

        public async Task HandleAsync(TwoFactorDisabledEvent domainEvent, CancellationToken cancellationToken = default)
        {
            _logger.LogInformation(
                "Handling TwoFactorDisabledEvent for UserId: {UserId}",
                domainEvent.UserId);

            await _auditService.LogAuditEventAsync(
                domainEvent.UserId,
                "TWO_FACTOR_DISABLED",
                "Two-factor authentication disabled",
                cancellationToken: cancellationToken);
        }
    }
}
