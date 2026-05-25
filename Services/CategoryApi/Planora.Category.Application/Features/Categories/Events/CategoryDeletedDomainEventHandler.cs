using Planora.BuildingBlocks.Application.Messaging;
using Planora.BuildingBlocks.Application.Messaging.Events;
using Planora.BuildingBlocks.Application.Outbox;
using Planora.Category.Domain.Events;
using Microsoft.Extensions.Logging;
using System;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace Planora.Category.Application.Features.Categories.Events
{
    public sealed class CategoryDeletedDomainEventHandler : IDomainEventHandler<CategoryDeletedDomainEvent>
    {
        private readonly IOutboxRepository _outboxRepository;
        private readonly ILogger<CategoryDeletedDomainEventHandler> _logger;

        public CategoryDeletedDomainEventHandler(
            IOutboxRepository outboxRepository,
            ILogger<CategoryDeletedDomainEventHandler> logger)
        {
            _outboxRepository = outboxRepository;
            _logger = logger;
        }

        public async Task HandleAsync(CategoryDeletedDomainEvent domainEvent, CancellationToken cancellationToken = default)
        {
            _logger.LogInformation(
                "Handling CategoryDeletedDomainEvent for CategoryId: {CategoryId} by UserId: {UserId}",
                domainEvent.CategoryId,
                domainEvent.UserId);

            try
            {
                var integrationEvent = new CategoryDeletedIntegrationEvent(
                    domainEvent.CategoryId,
                    domainEvent.UserId);

                var eventType = integrationEvent.GetType().AssemblyQualifiedName ?? integrationEvent.GetType().Name;
                var eventContent = JsonSerializer.Serialize(integrationEvent);

                var outboxMessage = new OutboxMessage(
                    eventType,
                    eventContent,
                    DateTime.UtcNow);

                await _outboxRepository.AddAsync(outboxMessage, cancellationToken);

                _logger.LogInformation(
                    "Published CategoryDeletedIntegrationEvent to Outbox for CategoryId: {CategoryId}",
                    domainEvent.CategoryId);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex,
                    "Failed to publish CategoryDeletedIntegrationEvent for CategoryId: {CategoryId}",
                    domainEvent.CategoryId);
                throw;
            }
        }
    }
}
