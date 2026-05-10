using Planora.Auth.Application.Common.Interfaces;
using Planora.Auth.Domain.Events;
using Planora.BuildingBlocks.Infrastructure.Messaging.Events;

namespace Planora.Messaging.Infrastructure.Handlers
{
    public sealed class UserCreatedEventHandler : IDomainEventHandler<UserCreatedEvent>
    {
        private readonly IEventBus _eventBus;
        private readonly IEmailService _emailService;
        private readonly ILogger<UserCreatedEventHandler> _logger;

        public UserCreatedEventHandler(
            IEventBus eventBus,
            IEmailService emailService,
            ILogger<UserCreatedEventHandler> logger)
        {
            _eventBus = eventBus;
            _emailService = emailService;
            _logger = logger;
        }

        public async Task HandleAsync(UserCreatedEvent domainEvent, CancellationToken cancellationToken = default)
        {
            _logger.LogInformation(
                "Handling UserCreatedEvent for UserId: {UserId}",
                domainEvent.UserId);

            var integrationEvent = new UserRegisteredIntegrationEvent(
                domainEvent.UserId,
                domainEvent.Email,
                domainEvent.FirstName,
                domainEvent.LastName);

            await _eventBus.PublishAsync(integrationEvent, cancellationToken);
        }
    }
}
