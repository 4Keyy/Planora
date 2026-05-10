using Planora.Auth.Application.Common.Interfaces;
using Planora.Auth.Domain.Events;

namespace Planora.Messaging.Infrastructure.Handlers
{
    public sealed class UserLoggedInEventHandler : IDomainEventHandler<UserLoggedInEvent>
    {
        private readonly IAuditService _auditService;
        private readonly ILogger<UserLoggedInEventHandler> _logger;

        public UserLoggedInEventHandler(
            IAuditService auditService,
            ILogger<UserLoggedInEventHandler> logger)
        {
            _auditService = auditService;
            _logger = logger;
        }

        public async Task HandleAsync(UserLoggedInEvent domainEvent, CancellationToken cancellationToken = default)
        {
            _logger.LogInformation(
                "User logged in: UserId={UserId}, IP={IpAddress}",
                domainEvent.UserId,
                domainEvent.IpAddress);

            await _auditService.LogAuditEventAsync(
                domainEvent.UserId,
                "USER_LOGGED_IN",
                $"Login from IP: {domainEvent.IpAddress}",
                domainEvent.IpAddress,
                cancellationToken);
        }
    }
}
