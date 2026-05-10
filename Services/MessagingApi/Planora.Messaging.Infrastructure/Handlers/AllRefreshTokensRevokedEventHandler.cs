using Planora.Auth.Application.Common.Interfaces;
using Planora.Auth.Domain.Events;

namespace Planora.Messaging.Infrastructure.Handlers
{
    public sealed class AllRefreshTokensRevokedEventHandler : IDomainEventHandler<AllRefreshTokensRevokedEvent>
    {
        private readonly IAuditService _auditService;
        private readonly ILogger<AllRefreshTokensRevokedEventHandler> _logger;

        public AllRefreshTokensRevokedEventHandler(
            IAuditService auditService,
            ILogger<AllRefreshTokensRevokedEventHandler> logger)
        {
            _auditService = auditService;
            _logger = logger;
        }

        public async Task HandleAsync(AllRefreshTokensRevokedEvent domainEvent, CancellationToken cancellationToken = default)
        {
            _logger.LogInformation(
                "All refresh tokens revoked for UserId: {UserId}",
                domainEvent.UserId);

            await _auditService.LogAuditEventAsync(
                domainEvent.UserId,
                "ALL_TOKENS_REVOKED",
                "All refresh tokens revoked",
                cancellationToken: cancellationToken);
        }
    }
}
