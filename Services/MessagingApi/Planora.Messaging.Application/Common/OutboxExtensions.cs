using System.Text.Json;
using Planora.BuildingBlocks.Application.Messaging;
using Planora.BuildingBlocks.Application.Outbox;

namespace Planora.Messaging.Application.Common
{
    /// <summary>
    /// Writes integration events into the Messaging outbox so the shared OutboxProcessor ships them
    /// to RabbitMQ (INV-COMM-3) instead of a handler publishing straight to the broker. Mirrors the
    /// Todo/Collaboration helpers so every producer serializes the envelope identically — the
    /// assembly-qualified type name lets each consumer resolve the concrete event type off the bus.
    /// </summary>
    internal static class OutboxExtensions
    {
        public static Task EnqueueIntegrationEventAsync(
            this IOutboxRepository outbox,
            IntegrationEvent integrationEvent,
            CancellationToken cancellationToken)
        {
            var message = new OutboxMessage(
                integrationEvent.GetType().AssemblyQualifiedName ?? integrationEvent.GetType().Name,
                JsonSerializer.Serialize(integrationEvent, integrationEvent.GetType()),
                DateTime.UtcNow);

            return outbox.AddAsync(message, cancellationToken);
        }
    }
}
