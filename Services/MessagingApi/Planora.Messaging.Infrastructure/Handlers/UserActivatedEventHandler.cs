using Planora.Auth.Application.Common.Interfaces;
using Planora.Auth.Domain.Events;

namespace Planora.Messaging.Infrastructure.Handlers
{
    public sealed class UserActivatedEventHandler : IDomainEventHandler<UserActivatedEvent>
    {
        private readonly IAuditService _auditService;
        private readonly ILogger<UserActivatedEventHandler> _logger;

        public UserActivatedEventHandler(
            IAuditService auditService,
            ILogger<UserActivatedEventHandler> logger)
        {
            _auditService = auditService;
            _logger = logger;
        }

        public async Task HandleAsync(UserActivatedEvent domainEvent, CancellationToken cancellationToken = default)
        {
            _logger.LogInformation(
                "User activated: UserId={UserId}, Email={Email}",
                domainEvent.UserId,
                domainEvent.Email);

            await _auditService.LogAuditEventAsync(
                domainEvent.UserId,
                "USER_ACTIVATED",
                $"User {domainEvent.Email} activated",
                cancellationToken: cancellationToken);
        }
    }
}
