using Planora.Auth.Application.Common.Interfaces;
using Planora.Auth.Domain.Events;

namespace Planora.Messaging.Infrastructure.Handlers
{
    public sealed class UserProfileUpdatedEventHandler : IDomainEventHandler<UserProfileUpdatedEvent>
    {
        private readonly IAuditService _auditService;
        private readonly ILogger<UserProfileUpdatedEventHandler> _logger;

        public UserProfileUpdatedEventHandler(
            IAuditService auditService,
            ILogger<UserProfileUpdatedEventHandler> logger)
        {
            _auditService = auditService;
            _logger = logger;
        }

        public async Task HandleAsync(UserProfileUpdatedEvent domainEvent, CancellationToken cancellationToken = default)
        {
            _logger.LogInformation(
                "Handling UserProfileUpdatedEvent for UserId: {UserId}",
                domainEvent.UserId);

            await _auditService.LogAuditEventAsync(
                domainEvent.UserId,
                "PROFILE_UPDATED",
                "User profile updated",
                cancellationToken: cancellationToken);
        }
    }
}
